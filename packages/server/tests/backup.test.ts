import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DriveReauthorizationRequiredError } from '../src/backup/drive.ts';
import { clearDriveGrant, readDriveGrant, writeDriveGrant } from '../src/backup/grant.ts';
import {
    type BackupFile,
    backupFailureAlert,
    backupFileName,
    clearOffsiteState,
    commitDump,
    decrypt,
    encrypt,
    generateKey,
    listLocalBackups,
    offsiteDestination,
    parseBackupFileName,
    parseKey,
    readLastSuccess,
    readOffsiteState,
    recordOffsiteFailure,
    removePartialDumps,
    runBackup,
    selectForDeletion,
    selectOffsiteDumps,
    selectRetained,
} from '../src/backup/index.ts';
import { config } from '../src/config.ts';
import { backupService } from '../src/modules/backup/backup.service.ts';
import { insertBranch, insertPatient, setupDatabase, truncateAll } from './helpers/db.ts';

async function scratch(): Promise<string> {
    const directory = join(tmpdir(), `lustre-backup-${Bun.randomUUIDv7()}`);
    await mkdir(directory, { recursive: true });
    return directory;
}

describe('backup file names', () => {
    test('round-trips a timestamp', () => {
        const at = new Date('2026-08-03T08:41:32.000Z');
        const name = backupFileName(at);

        expect(name).toBe('lustre-2026-08-03T08-41-32Z.dump');
        expect(parseBackupFileName(name)?.toISOString()).toBe(at.toISOString());
    });

    test('sorts lexically in the same order as chronologically', () => {
        const a = backupFileName(new Date('2026-08-03T08:00:00Z'));
        const b = backupFileName(new Date('2026-08-03T09:00:00Z'));
        const c = backupFileName(new Date('2026-09-01T00:00:00Z'));

        expect([c, a, b].sort()).toEqual([a, b, c]);
    });

    test('ignores anything that is not a dump', () => {
        expect(parseBackupFileName('last-success.json')).toBeNull();
        expect(parseBackupFileName('notes.txt')).toBeNull();
        expect(parseBackupFileName('lustre-nonsense.dump')).toBeNull();
    });
});

describe('retention', () => {
    function daily(days: number, end = new Date('2027-01-01T00:00:00Z')): BackupFile[] {
        return Array.from({ length: days }, (_, i) => {
            const at = new Date(end.getTime() - i * 86_400_000);
            return { name: backupFileName(at), at };
        });
    }

    test('keeps everything when there is less than the daily allowance', () => {
        const files = daily(10);
        expect(selectForDeletion(files)).toEqual([]);
    });

    test('keeps the 14 most recent days', () => {
        const files = daily(60);
        const retained = selectRetained(files);

        for (const file of files.slice(0, 14)) {
            expect(retained.has(file)).toBe(true);
        }
    });

    test('thins older dumps to weeklies and monthlies', () => {
        const files = daily(400);
        const retained = selectRetained(files);

        expect(retained.size).toBeLessThanOrEqual(14 + 8 + 12);
        expect(retained.size).toBeGreaterThan(20);
        expect(selectForDeletion(files).length).toBe(files.length - retained.size);
    });

    test('keeps the newest dump of a day when several were taken', () => {
        const morning = { name: 'a', at: new Date('2027-01-01T06:00:00Z') };
        const evening = { name: 'b', at: new Date('2027-01-01T20:00:00Z') };
        const retained = selectRetained([morning, evening], { daily: 1, weekly: 0, monthly: 0 });

        expect(retained.has(evening)).toBe(true);
        expect(retained.has(morning)).toBe(false);
    });

    test('keeps one of two dumps that share a name, and deletes the other', () => {
        const at = new Date('2027-01-01T00:00:00Z');
        const first = { name: 'lustre-2027-01-01T00-00-00Z.dump', at };
        const second = { name: 'lustre-2027-01-01T00-00-00Z.dump', at };

        const retained = selectRetained([first, second], { daily: 1, weekly: 0, monthly: 0 });
        const doomed = selectForDeletion([first, second], { daily: 1, weekly: 0, monthly: 0 });

        expect(retained.size).toBe(1);
        expect(doomed.length).toBe(1);
        expect(retained.has(doomed[0] as (typeof doomed)[number])).toBe(false);
    });

    test('a dump older than every window is deleted', () => {
        const files = [
            { name: 'recent', at: new Date('2027-01-01T00:00:00Z') },
            { name: 'ancient', at: new Date('2020-01-01T00:00:00Z') },
        ];
        const doomed = selectForDeletion(files, { daily: 1, weekly: 1, monthly: 1 });

        expect(doomed.map((f) => f.name)).toEqual(['ancient']);
    });
});

describe('a dump is named only once it is complete, checked and on disk', () => {
    const name = backupFileName(new Date('2027-01-01T00:00:00Z'));

    test('a dump that passes gets its final name and leaves nothing behind', async () => {
        const directory = await scratch();
        try {
            await commitDump(join(directory, name), (partial) => writeFile(partial, 'complete dump'));

            expect(await readdir(directory)).toEqual([name]);
            expect(await Bun.file(join(directory, name)).text()).toBe('complete dump');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('an interrupted dump never gets the final name', async () => {
        const directory = await scratch();
        try {
            const run = commitDump(join(directory, name), async (partial) => {
                await writeFile(partial, 'half a du');
                throw new Error('pg_dump exited 1');
            });

            await expect(run).rejects.toThrow('pg_dump exited 1');
            expect(await readdir(directory)).toEqual([]);
            expect(await listLocalBackups(directory)).toEqual([]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a dump that fails the restore check never gets the final name', async () => {
        const directory = await scratch();
        try {
            const run = commitDump(join(directory, name), async (partial) => {
                await writeFile(partial, 'complete but wrong dump');
                throw new Error('restored patients has 0 rows, source had 3');
            });

            await expect(run).rejects.toThrow('restored patients');
            expect(await readdir(directory)).toEqual([]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a failed run leaves the previous good dump alone', async () => {
        const directory = await scratch();
        try {
            const previous = backupFileName(new Date('2026-12-31T00:00:00Z'));
            await writeFile(join(directory, previous), 'yesterday');

            await commitDump(join(directory, name), async () => {
                throw new Error('pg_dump exited 1');
            }).catch(() => {});

            expect(await readdir(directory)).toEqual([previous]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test("two runs that share a name cannot delete or rename each other's dump", async () => {
        const directory = await scratch();
        try {
            const path = join(directory, name);
            let failing!: () => void;
            const failingStarted = new Promise<void>((resolve) => {
                failing = resolve;
            });

            const good = commitDump(path, async (partial) => {
                await writeFile(partial, 'complete dump');
                await failingStarted;
            });
            const bad = commitDump(path, async (partial) => {
                await writeFile(partial, 'half a du');
                failing();
                throw new Error('pg_dump exited 1');
            });

            await expect(bad).rejects.toThrow('pg_dump exited 1');
            await good;

            expect(await readdir(directory)).toEqual([name]);
            expect(await Bun.file(path).text()).toBe('complete dump');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a run killed part-way leaves a .partial that is not a backup, and the next start removes it', async () => {
        const directory = await scratch();
        try {
            const good = backupFileName(new Date('2026-12-31T00:00:00Z'));
            await writeFile(join(directory, good), 'yesterday');
            const leftover = `${name}.${Bun.randomUUIDv7()}.partial`;
            await writeFile(join(directory, leftover), 'half a du');
            await writeFile(join(directory, 'drive-grant.json'), '{}');
            await writeFile(join(directory, 'notes.partial'), 'not ours');

            expect((await listLocalBackups(directory)).map((f) => f.name)).toEqual([good]);

            expect(await removePartialDumps(directory)).toEqual([leftover]);
            expect((await readdir(directory)).sort()).toEqual(
                [good, 'drive-grant.json', 'notes.partial'].sort(),
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('removing leftovers from a folder that does not exist yet is a no-op', async () => {
        expect(await removePartialDumps(join(tmpdir(), `lustre-missing-${Bun.randomUUIDv7()}`))).toEqual([]);
    });
});

describe('offsiteDestination', () => {
    test('is null when nothing is configured, so a run stays local', async () => {
        expect(await offsiteDestination()).toBeNull();
    });
});

describe('backup failure alerts', () => {
    test('tells the operator to reauthorize Drive when the refresh grant is invalid', () => {
        const alert = backupFailureAlert(
            new DriveReauthorizationRequiredError(),
            'lustre-2026-08-03T08-41-32Z.dump',
        );

        expect(alert.code).toBe('backup.drive_reauthorization_required');
        expect(alert.summary).toContain('drive:authorize');
        expect(alert.context).not.toHaveProperty('error');
    });
});

describe('a revoked Drive grant outlives the run that found it', () => {
    test('nothing is recorded until a grant actually fails', async () => {
        const directory = await scratch();
        try {
            expect(await readOffsiteState(directory)).toBeNull();

            await recordOffsiteFailure(directory, new Error('pg_dump produced an empty file'), new Date());
            expect(await readOffsiteState(directory)).toBeNull();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('keeps the first failure, so the age shown does not reset every night', async () => {
        const directory = await scratch();
        try {
            const first = new Date('2026-09-17T03:00:00Z');
            await recordOffsiteFailure(directory, new DriveReauthorizationRequiredError(), first);
            await recordOffsiteFailure(
                directory,
                new DriveReauthorizationRequiredError(),
                new Date('2026-09-20T03:00:00Z'),
            );

            expect(await readOffsiteState(directory)).toEqual({
                reauthorizationRequiredSince: first.toISOString(),
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a later upload clears it', async () => {
        const directory = await scratch();
        try {
            await recordOffsiteFailure(directory, new DriveReauthorizationRequiredError(), new Date());
            expect(await readOffsiteState(directory)).not.toBeNull();

            await clearOffsiteState(directory);
            expect(await readOffsiteState(directory)).toBeNull();

            await clearOffsiteState(directory);
            expect(await readOffsiteState(directory)).toBeNull();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('leaves no scratch file behind, so status only ever sees whole JSON', async () => {
        const directory = await scratch();
        try {
            await recordOffsiteFailure(directory, new DriveReauthorizationRequiredError(), new Date());

            const left = await readdir(directory);
            expect(left).toEqual(['offsite-state.json']);
            expect(await readOffsiteState(directory)).toHaveProperty('reauthorizationRequiredSince');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a directory that is not there reads as no state, not as a crash', async () => {
        expect(await readOffsiteState(join(tmpdir(), `lustre-missing-${Bun.randomUUIDv7()}`))).toBeNull();
    });
});

describe('the grant the phone makes', () => {
    async function scratchDir(): Promise<string> {
        const directory = join(tmpdir(), `lustre-grant-${Bun.randomUUIDv7()}`);
        await mkdir(directory, { recursive: true });
        return directory;
    }

    const grant = {
        clientId: 'android-client.apps.googleusercontent.com',
        refreshToken: 'refresh-from-the-phone',
        folderId: 'folder-linked',
        account: 'doctor@example.com',
        linkedAt: '2026-09-20T03:00:00.000Z',
    };

    test('round-trips, and is readable only by the server user', async () => {
        const directory = await scratchDir();
        try {
            await writeDriveGrant(grant, directory);

            expect(await readDriveGrant(directory)).toEqual(grant);
            const mode = (await stat(join(directory, 'drive-grant.json'))).mode & 0o777;
            expect(mode).toBe(0o600);
            expect(await readdir(directory)).toEqual(['drive-grant.json']);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('a half-written grant reads as none rather than as a broken one', async () => {
        const directory = await scratchDir();
        try {
            await Bun.write(join(directory, 'drive-grant.json'), '{"clientId":"only-this"}');
            expect(await readDriveGrant(directory)).toBeNull();

            await Bun.write(join(directory, 'drive-grant.json'), 'not json at all');
            expect(await readDriveGrant(directory)).toBeNull();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('clearing one that is not there is what every unlinked clinic does', async () => {
        const directory = await scratchDir();
        try {
            await clearDriveGrant(directory);
            expect(await readDriveGrant(directory)).toBeNull();
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

describe('backup.status', () => {
    test('reports a clinic that has never backed up as stale, not as an error', async () => {
        const status = await backupService.status();

        expect(status.lastSuccessAt).toBeNull();
        expect(status.stale).toBe(true);
        expect(status.staleAfterHours).toBe(config.BACKUP_STALE_AFTER_HOURS);
        expect(status.offsite).toEqual({
            configured: false,
            reauthorizationRequiredSince: null,
            account: null,
            canSignIn: false,
        });
    });
});

describe('off-site listings', () => {
    const dump = `${backupFileName(new Date('2027-01-01T00:00:00Z'))}.enc`;

    test('reads the timestamp back out of an encrypted dump name', () => {
        const [file] = selectOffsiteDumps([{ name: dump, handle: 'drive-id-1' }]);

        expect(file?.at.toISOString()).toBe('2027-01-01T00:00:00.000Z');
        expect(file?.handle).toBe('drive-id-1');
    });

    test('a file whose name is not a dump is never a candidate for pruning', () => {
        const entries = [
            { name: dump, handle: 'ours' },
            { name: 'clinic-scans.zip', handle: 'theirs' },
            { name: 'lustre-nonsense.dump.enc', handle: 'malformed' },
            { name: 'notes.txt', handle: 'notes' },
        ];

        expect(selectOffsiteDumps(entries).map((f) => f.handle)).toEqual(['ours']);
        const doomed = selectForDeletion(selectOffsiteDumps(entries), { daily: 0, weekly: 0, monthly: 0 });
        expect(doomed.map((f) => f.handle)).toEqual(['ours']);
    });

    test('carries the handle through retention, so deletion never looks up by name', () => {
        const older = `${backupFileName(new Date('2020-01-01T00:00:00Z'))}.enc`;
        const doomed = selectForDeletion(
            selectOffsiteDumps([
                { name: dump, handle: 'newest' },
                { name: older, handle: 'copy-a' },
                { name: older, handle: 'copy-b' },
            ]),
            { daily: 1, weekly: 1, monthly: 1 },
        );

        expect(doomed.map((f) => f.handle).sort()).toEqual(['copy-a', 'copy-b']);
    });

    test('a duplicate of the newest dump is pruned rather than kept forever', () => {
        const doomed = selectForDeletion(
            selectOffsiteDumps([
                { name: dump, handle: 'keep-one' },
                { name: dump, handle: 'keep-two' },
            ]),
            { daily: 1, weekly: 1, monthly: 1 },
        );

        expect(doomed.length).toBe(1);
        expect(['keep-one', 'keep-two']).toContain(doomed[0]?.handle ?? '');
    });
});

describe('encryption', () => {
    test('round-trips a payload', () => {
        const key = parseKey(generateKey());
        const plaintext = new TextEncoder().encode('PGDMP fake dump body');

        expect(decrypt(encrypt(plaintext, key), key)).toEqual(Buffer.from(plaintext));
    });

    test('accepts a hex key and a base64 key', () => {
        expect(parseKey(Buffer.alloc(32, 7).toString('hex')).length).toBe(32);
        expect(parseKey(Buffer.alloc(32, 7).toString('base64')).length).toBe(32);
    });

    test('rejects a key of the wrong length', () => {
        expect(() => parseKey('too-short')).toThrow();
        expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow();
    });

    test('the ciphertext does not contain the plaintext', () => {
        const key = parseKey(generateKey());
        const secret = 'patient-name-that-must-not-leak';
        const envelope = encrypt(new TextEncoder().encode(secret), key);

        expect(envelope.toString('binary')).not.toContain(secret);
    });

    test('refuses a payload that has been tampered with', () => {
        const key = parseKey(generateKey());
        const envelope = encrypt(new TextEncoder().encode('body'), key);
        envelope.writeUInt8(envelope.readUInt8(envelope.length - 1) ^ 0xff, envelope.length - 1);

        expect(() => decrypt(envelope, key)).toThrow();
    });

    test('refuses the wrong key', () => {
        const envelope = encrypt(new TextEncoder().encode('body'), parseKey(generateKey()));

        expect(() => decrypt(envelope, parseKey(generateKey()))).toThrow();
    });

    test('refuses a file that is not an envelope', () => {
        expect(() => decrypt(new TextEncoder().encode('just a dump'), parseKey(generateKey()))).toThrow(
            'not a lustre backup envelope',
        );
    });
});

function pgBinary(program: string): string {
    return config.PG_BIN_DIR ? join(config.PG_BIN_DIR, program) : program;
}

async function isRunnable(program: string): Promise<boolean> {
    try {
        return (
            (await Bun.spawn([pgBinary(program), '--version'], { stdout: 'ignore', stderr: 'ignore' })
                .exited) === 0
        );
    } catch {
        return false;
    }
}

const hasPgTools = (await isRunnable('pg_dump')) && (await isRunnable('pg_restore'));

if (!hasPgTools && Bun.env.CI) {
    throw new Error(
        `pg_dump/pg_restore are not runnable (PG_BIN_DIR=${config.PG_BIN_DIR ?? 'unset'}). ` +
            'The backup restore test is the only proof a dump is usable, and CI must ' +
            'not skip it — install postgresql-client.',
    );
}

describe.skipIf(!hasPgTools)('runBackup', () => {
    const directory = join(tmpdir(), `lustre-backup-test-${Bun.randomUUIDv7()}`);

    beforeAll(async () => {
        await setupDatabase();
        await truncateAll();
        await insertPatient();
        await insertBranch();
    });

    test('dumps, verifies by restoring, prunes, and records success', async () => {
        try {
            const result = await runBackup({
                directory,
                now: new Date('2027-01-01T00:00:00Z'),
                offsite: false,
            });

            expect(result.bytes).toBeGreaterThan(0);
            expect(result.verified).toBe(true);
            expect(result.offsiteKey).toBeNull();

            const files = await listLocalBackups(directory);
            expect(files.map((f) => f.name)).toContain(result.file);

            const marker = await readLastSuccess(directory);
            expect(marker?.file).toBe(result.file);
            expect((await readdir(directory)).filter((n) => n.endsWith('.partial'))).toEqual([]);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }, 60_000);

    test('a failed pg_dump leaves no file with a dump name', async () => {
        const failing = join(tmpdir(), `lustre-backup-fail-${Bun.randomUUIDv7()}`);
        const missing = new URL(config.DATABASE_URL);
        missing.pathname = '/lustre_does_not_exist_test';
        try {
            const run = runBackup({
                databaseUrl: missing.toString(),
                directory: failing,
                now: new Date('2027-01-02T00:00:00Z'),
                offsite: false,
            });

            await expect(run).rejects.toThrow('pg_dump');
            const names = await readdir(failing);
            expect(names.filter((n) => n.includes('.dump'))).toEqual([]);
        } finally {
            await rm(failing, { recursive: true, force: true });
        }
    }, 60_000);
});
