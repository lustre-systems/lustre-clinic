import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { type Alert, alert } from '../monitoring/index.ts';
import { commitDump } from './atomic.ts';
import { encrypt, parseKey } from './crypto.ts';
import { offsiteDestination } from './destination.ts';
import { DRIVE_REAUTHORIZATION_CODE, isDriveReauthorizationRequired } from './drive.ts';
import { databaseName, pgDump, pgRestore, withScratchDatabase } from './pg.ts';
import {
    type BackupFile,
    backupFileName,
    DEFAULT_RETENTION,
    parseBackupFileName,
    type RetentionPolicy,
    selectForDeletion,
} from './retention.ts';

export * from './atomic.ts';
export * from './crypto.ts';
export * from './destination.ts';
export * from './retention.ts';

const MARKER_FILE = 'last-success.json';
const OFFSITE_STATE_FILE = 'offsite-state.json';

export interface BackupResult {
    readonly file: string;
    readonly bytes: number;
    readonly verified: boolean;
    readonly offsiteKey: string | null;
    readonly pruned: readonly string[];
}

export interface BackupOptions {
    databaseUrl?: string;
    directory?: string;
    retention?: RetentionPolicy;
    now?: Date;
    verify?: boolean;
    offsite?: boolean;
}

export function backupFailureAlert(error: unknown, file: string): Alert {
    if (isDriveReauthorizationRequired(error)) {
        return {
            code: DRIVE_REAUTHORIZATION_CODE,
            summary:
                'Google Drive authorization expired or was revoked. Run `bun drive:authorize` on the operator machine.',
            context: { file },
        };
    }
    return {
        code: 'backup.failed',
        summary: 'A backup run failed. The clinic is running without a fresh backup.',
        context: { file, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' },
    };
}

export async function listLocalBackups(directory: string): Promise<BackupFile[]> {
    let names: string[];
    try {
        names = await readdir(directory);
    } catch {
        return [];
    }

    const files: BackupFile[] = [];
    for (const name of names) {
        const at = parseBackupFileName(name);
        if (at) files.push({ name, at });
    }
    return files.sort((a, b) => b.at.getTime() - a.at.getTime());
}

async function verifyDump(databaseUrl: string, dumpFile: string, at: Date): Promise<void> {
    const counted = ['patients', 'appointments', 'visits', 'payments'] as const;

    const source = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    let expected: Record<string, number>;
    try {
        expected = await countRows(source, counted);
    } finally {
        await source.end();
    }

    const scratch = `${databaseName(databaseUrl)}_verify_${at.getTime()}`;

    await withScratchDatabase(databaseUrl, scratch, async (scratchUrl) => {
        await pgRestore(scratchUrl, dumpFile);

        const restored = postgres(scratchUrl, { max: 1, onnotice: () => {} });
        try {
            const actual = await countRows(restored, counted);

            for (const table of counted) {
                if (actual[table] !== expected[table]) {
                    throw new Error(
                        `restored ${table} has ${actual[table]} rows, source had ${expected[table]}`,
                    );
                }
            }

            const [row] = await restored<{ present: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap'
                ) AS present
            `;
            if (!row?.present) {
                throw new Error('restored database is missing appointments_no_overlap');
            }
        } finally {
            await restored.end();
        }
    });
}

async function countRows(sql: postgres.Sql, tables: readonly string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of tables) {
        const [row] = await sql.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM "${table}"`);
        counts[table] = Number(row?.n ?? 0);
    }
    return counts;
}

async function uploadOffsite(localPath: string, name: string): Promise<string | null> {
    const destination = await offsiteDestination();
    if (!destination) return null;

    if (!config.BACKUP_ENCRYPTION_KEY) {
        throw new Error(
            'an off-site destination is configured but BACKUP_ENCRYPTION_KEY is not — refusing to upload',
        );
    }

    const plaintext = await Bun.file(localPath).bytes();
    const handle = await destination.upload(
        `${name}.enc`,
        encrypt(plaintext, parseKey(config.BACKUP_ENCRYPTION_KEY)),
    );

    logger.info({ destination: destination.kind, file: name }, 'off-site copy uploaded');
    return handle;
}

async function pruneLocal(directory: string, policy: RetentionPolicy): Promise<string[]> {
    const doomed = selectForDeletion(await listLocalBackups(directory), policy);

    for (const file of doomed) {
        await unlink(join(directory, file.name));
    }
    return doomed.map((f) => f.name);
}

async function pruneOffsite(policy: RetentionPolicy): Promise<number> {
    const destination = await offsiteDestination();
    if (!destination) return 0;

    const doomed = selectForDeletion(await destination.list(), policy);

    for (const file of doomed) {
        await destination.remove(file.handle);
    }
    return doomed.length;
}

export interface BackupMarker {
    at: string;
    file: string;
    bytes: number;
}

export async function readLastSuccess(directory = config.BACKUP_DIR): Promise<BackupMarker | null> {
    try {
        return (await Bun.file(join(directory, MARKER_FILE)).json()) as BackupMarker;
    } catch {
        return null;
    }
}

export interface OffsiteState {
    reauthorizationRequiredSince: string;
}

export async function readOffsiteState(directory = config.BACKUP_DIR): Promise<OffsiteState | null> {
    try {
        return (await Bun.file(join(directory, OFFSITE_STATE_FILE)).json()) as OffsiteState;
    } catch {
        return null;
    }
}

export async function recordOffsiteFailure(directory: string, error: unknown, at: Date): Promise<void> {
    if (!isDriveReauthorizationRequired(error)) return;
    if (await readOffsiteState(directory)) return;

    const state: OffsiteState = { reauthorizationRequiredSince: at.toISOString() };
    const target = join(directory, OFFSITE_STATE_FILE);
    const scratch = `${target}.${process.pid}.tmp`;
    await Bun.write(scratch, JSON.stringify(state));
    await rename(scratch, target);
}

export async function clearOffsiteState(directory: string): Promise<void> {
    await unlink(join(directory, OFFSITE_STATE_FILE)).catch(() => {});
}

export async function runBackup(options: BackupOptions = {}): Promise<BackupResult> {
    const {
        databaseUrl = config.DATABASE_URL,
        directory = config.BACKUP_DIR,
        retention = DEFAULT_RETENTION,
        now = new Date(),
        verify = true,
        offsite = true,
    } = options;

    const name = backupFileName(now);
    const path = join(directory, name);

    try {
        await mkdir(directory, { recursive: true });

        let size = 0;
        await commitDump(path, async (partial) => {
            await pgDump(databaseUrl, partial);
            size = (await stat(partial)).size;
            if (size === 0) throw new Error('pg_dump produced an empty file');

            if (verify) await verifyDump(databaseUrl, partial, now);
        });

        const offsiteKey = offsite ? await uploadOffsite(path, name) : null;
        if (offsiteKey !== null) await clearOffsiteState(directory);

        const pruned = await pruneLocal(directory, retention);
        const prunedOffsite = offsite ? await pruneOffsite(retention) : 0;

        const marker: BackupMarker = { at: now.toISOString(), file: name, bytes: size };
        await Bun.write(join(directory, MARKER_FILE), JSON.stringify(marker));

        logger.info(
            {
                file: name,
                bytes: size,
                verified: verify,
                offsite: offsiteKey !== null,
                pruned: pruned.length,
                prunedOffsite,
            },
            'backup complete',
        );

        return { file: name, bytes: size, verified: verify, offsiteKey, pruned };
    } catch (err) {
        logger.error({ err }, 'backup failed');
        try {
            await recordOffsiteFailure(directory, err, now);
        } catch (stateErr) {
            logger.error({ err: stateErr }, 'could not record the off-site backup state');
        }
        await alert(backupFailureAlert(err, name));
        throw err;
    }
}
