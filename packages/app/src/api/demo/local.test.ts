/**
 * Local mode is a real clinic answered from the phone. What it must never do is
 * the thing the demo is allowed to: say a write was saved when the file did not
 * take it, or replace a clinic it could not read with an empty one.
 *
 * The file system is an in-memory stand-in with the two behaviours that matter
 * here — a write that can be made to fail, and a move that replaces the target —
 * plus a file picker and a share sheet that hand over and take whatever the
 * test says.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { gunzipSync, gzipSync } from 'fflate';

const stored = new Map<string, string>();
const files = new Map<string, string | Uint8Array>();
let writesFail = false;
/** The backup the next `pickClinicFile` reads, as Drive would hand it back. */
let pickable: string | Uint8Array = '';

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

mock.module('expo-constants', () => ({
    default: { expoConfig: { extra: { demo: false, driveClientId: 'client' } } },
}));

// A clinic's own build: local mode must not depend on the demo being allowed.
mock.module('../config', () => ({ BUILD_VARIANT: 'prod' }));

class MemoryFile {
    constructor(
        _dir: unknown,
        readonly name: string,
    ) {}

    get exists(): boolean {
        return files.has(this.name);
    }

    textSync(): string {
        const text = files.get(this.name);
        if (text === undefined) throw new Error('missing');
        return typeof text === 'string' ? text : new TextDecoder().decode(text);
    }

    bytes(): Promise<Uint8Array> {
        const content = files.get(this.name);
        if (content === undefined) throw new Error('missing');
        return Promise.resolve(typeof content === 'string' ? new TextEncoder().encode(content) : content);
    }

    write(content: string | Uint8Array): void {
        if (writesFail) throw new Error('disk full');
        files.set(this.name, content);
    }

    get uri(): string {
        return `file:///${this.name}`;
    }

    moveSync(target: MemoryFile): void {
        files.set(target.name, files.get(this.name) ?? '');
        files.delete(this.name);
    }

    copySync(target: MemoryFile): void {
        files.set(target.name, files.get(this.name) ?? '');
    }

    delete(): void {
        files.delete(this.name);
    }
}

mock.module('expo-file-system', () => ({
    File: MemoryFile,
    Paths: { document: 'documents', cache: 'cache' },
}));

/** Real SQLite, in memory: the transaction is what these tests are about. */
const sqlite = new Database(':memory:');

function opened(database: Database) {
    return {
        execSync: (source: string) => database.exec(source),
        runSync: (source: string, params: string[] = []) => {
            if (writesFail && !source.startsWith('DELETE')) throw new Error('disk full');
            return database.query(source).run(...params);
        },
        getAllSync: (source: string) => database.query(source).all(),
        getFirstSync: (source: string, params: string[]) => database.query(source).get(...params),
        withTransactionSync: (task: () => void) => database.transaction(task)(),
        serializeSync: () => database.serialize(),
        closeSync: () => database.close(),
    };
}

mock.module('expo-sqlite', () => ({
    openDatabaseSync: (name: string) => opened(name === ':memory:' ? new Database(':memory:') : sqlite),
    deserializeDatabaseSync: (bytes: Uint8Array) => opened(Database.deserialize(bytes)),
}));

function resetStore(): void {
    sqlite.exec(`
        DROP TABLE IF EXISTS clinic_rows;
        DROP TABLE IF EXISTS clinic_meta;
        CREATE TABLE clinic_rows (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, UNIQUE (tbl, id));
        CREATE TABLE clinic_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
}

/** What a table holds in the store, not in memory. */
function storedRows<T>(table: string): T[] {
    return sqlite
        .query('SELECT json FROM clinic_rows WHERE tbl = ? ORDER BY seq')
        .all(table)
        .map((row) => JSON.parse((row as { json: string }).json) as T);
}

const secure = new Map<string, string>();
mock.module('expo-secure-store', () => ({
    getItem: (key: string) => secure.get(key) ?? null,
    setItemAsync: (key: string, value: string) => Promise.resolve(void secure.set(key, value)),
    deleteItemAsync: (key: string) => Promise.resolve(void secure.delete(key)),
}));

/** Google, as much of it as the backups talk to. */
const drive = {
    files: [] as { id: string; name: string; createdTime: string; size: string; bytes: Uint8Array }[],
    uploads: 0,
    down: false,
    offline: false,
    grantRevoked: false,
    revoked: [] as string[],
};

function reply(status: number, body: unknown = {}, bytes?: Uint8Array) {
    return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        arrayBuffer: () => Promise.resolve((bytes ?? new Uint8Array()).slice().buffer),
    });
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
    return Buffer.from(haystack).indexOf(Buffer.from(needle));
}

mock.module('expo/fetch', () => ({
    fetch: (url: string, init?: { method?: string; body?: Uint8Array | string }) => {
        if (drive.offline) return Promise.reject(new Error('no network'));
        if (url.endsWith('/token')) {
            if (drive.grantRevoked) return reply(400, { error: 'invalid_grant' });
            return reply(200, { access_token: 'access', expires_in: 3600 });
        }
        if (url.endsWith('/revoke')) {
            drive.revoked.push(String(init?.body));
            return reply(200);
        }
        if (drive.down) return reply(503);
        if (url.includes('/about')) return reply(200, { user: { emailAddress: 'clinic@example.com' } });
        if (url.includes('/upload/')) {
            const body = init?.body as Uint8Array;
            const start = indexOfBytes(body, new Uint8Array([0x1f, 0x8b]));
            const bytes = body.slice(start, body.length - '\r\n--lustre-clinic-backup--'.length);
            drive.uploads += 1;
            const name = /"name":"([^"]+)"/.exec(new TextDecoder().decode(body.slice(0, start)))?.[1] ?? '';
            drive.files.push({
                id: `file-${drive.uploads}`,
                name,
                createdTime: new Date(Date.UTC(2026, 0, drive.uploads)).toISOString(),
                size: String(bytes.length),
                bytes,
            });
            return reply(200, { id: `file-${drive.uploads}` });
        }
        const id = /files\/([^?]+)/.exec(url)?.[1];
        if (id && init?.method === 'DELETE') {
            drive.files = drive.files.filter((file) => file.id !== id);
            return reply(204);
        }
        if (id) return reply(200, {}, drive.files.find((file) => file.id === id)?.bytes);
        return reply(200, {
            files: [...drive.files].sort((a, b) => b.createdTime.localeCompare(a.createdTime)),
        });
    },
}));

const { createTRPCClient } = await import('@trpc/client');
const { demoLink } = await import('./link');
const { startLocalMode, startLocalModeFrom } = await import('./index');
const { clinicSnapshot, pickedFromSnapshot } = await import('./local');
const {
    backUpIfDue,
    backUpToDrive,
    deleteDriveBackups,
    fetchDriveBackup,
    hydrateDriveLink,
    linkDrive,
    listDriveBackups,
    unlinkDrive,
} = await import('./localDrive');
const { disableLocalMode, isLocalMode } = await import('./flag');
const { setDb } = await import('./db');
const { freshLocalDb, LocalStoreError, parseLocal, serializeLocal } = await import('./localFormat');
const { seedDemoDb } = await import('./seed');
const { LOCAL_CLINIC_TABLES_SQL, localClinicFileSchema } = await import('@lustre/shared');
const { credentialToken } = await import('../credential');
const { clinicGeneration } = await import('../dataReset');
const { noteDriveLink, noteLastDriveBackupAt } = await import('./exported');

import type { AppRouter } from '@lustre/server/src/trpc/router.ts';

const client = createTRPCClient<AppRouter>({ links: [demoLink] });

async function pickClinicFile() {
    return pickedFromSnapshot(typeof pickable === 'string' ? new TextEncoder().encode(pickable) : pickable);
}

const LEGACY = 'lustre-local.json';
const STORED = 'SELECT count(*) AS n FROM clinic_rows';

/** A launch: nothing in memory, whatever is in storage and on file. */
function relaunch(): void {
    setDb(freshLocalDb(), 'demo');
}

beforeEach(async () => {
    await disableLocalMode();
    stored.clear();
    files.clear();
    writesFail = false;
    resetStore();
    pickable = '';
    secure.clear();
    drive.files = [];
    drive.uploads = 0;
    drive.down = false;
    drive.offline = false;
    drive.grantRevoked = false;
    drive.revoked = [];
    relaunch();
});

// The flag is module state, and bun runs the other files in this process too.
afterEach(disableLocalMode);

describe('the clinic file', () => {
    it('starts with a branch and a working week, and no catalogue', () => {
        const db = freshLocalDb();

        expect(db.branches.map((branch) => branch.name)).toEqual(['Main']);
        expect(db.clinicDays.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 6]);
        expect(db.procedureTypes).toEqual([]);
        expect(db.patients).toEqual([]);
    });

    it('reads back what it wrote, dates and all', () => {
        const db = freshLocalDb();

        const read = parseLocal(serializeLocal(db));

        expect(read.settings.updatedAt).toBeInstanceOf(Date);
        expect(read.branches).toEqual(db.branches);
    });

    it('reads a file from before costs as costing nothing', () => {
        const db = freshLocalDb();
        const old = JSON.parse(serializeLocal(db));
        old.db.procedureTypes = [{ id: 'p', name: 'Checkup', defaultPrice: 100 }];
        old.db.visitProcedures = [{ id: 'l', visitId: 'v', procedureId: 'p', quantity: 1, unitPrice: 100 }];

        const read = parseLocal(JSON.stringify(old));

        expect(read.procedureTypes[0]?.cost).toBe(0);
        expect(read.visitProcedures[0]?.unitCost).toBe(0);
    });

    it('refuses a file it cannot read rather than calling it empty', () => {
        expect(() => parseLocal('{not json')).toThrow(LocalStoreError);
        expect(() => parseLocal(JSON.stringify({ version: 1, db: {} }))).toThrow(LocalStoreError);
        const { branches: _, ...missingBranches } = freshLocalDb();
        expect(() =>
            parseLocal(JSON.stringify({ format: 'lustre-local', version: 1, db: missingBranches })),
        ).toThrow(LocalStoreError);
        expect(() =>
            parseLocal(JSON.stringify({ format: 'lustre-local', version: 99, db: freshLocalDb() })),
        ).toThrow(LocalStoreError);
    });
});

describe('local mode', () => {
    it('makes this phone the admin of a clinic written to file', async () => {
        await startLocalMode();

        expect(isLocalMode()).toBe(true);
        expect(credentialToken()).not.toBeNull();
        expect(await client.device.me.query()).toMatchObject({ role: 'admin', label: 'This phone' });
        expect(storedRows('settings')).toHaveLength(1);
    });

    it('has a write on file before it answers', async () => {
        await startLocalMode();

        await client.branch.create.mutate({ name: 'Second' });

        const onFile = storedRows<{ name: string }>('branches');
        expect(onFile.map((branch) => branch.name).sort()).toEqual(['Main', 'Second']);
    });

    it('writes only the rows a request changed', async () => {
        await startLocalMode();
        const before = sqlite.query('SELECT seq, tbl, id FROM clinic_rows ORDER BY seq').all();

        await client.branch.create.mutate({ name: 'Second' });

        const after = sqlite.query('SELECT seq, tbl, id FROM clinic_rows ORDER BY seq').all();
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after).toHaveLength(before.length + 1);
    });

    it('refuses a write the phone would not take, and keeps the clinic as it was', async () => {
        await startLocalMode();
        writesFail = true;

        await expect(client.branch.create.mutate({ name: 'Lost' })).rejects.toThrow();

        writesFail = false;
        const branches = await client.branch.list.query({ includeInactive: true });
        expect(branches.map((branch) => branch.name)).toEqual(['Main']);
    });

    it('opens the same clinic on the next launch', async () => {
        await startLocalMode();
        await client.branch.create.mutate({ name: 'Second' });

        relaunch();
        await startLocalMode();

        const branches = await client.branch.list.query({ includeInactive: true });
        expect(branches.map((branch) => branch.name).sort()).toEqual(['Main', 'Second']);
    });

    it('leaves an old clinic file it cannot read alone, and does not switch over', async () => {
        files.set(LEGACY, '{not json');

        await expect(startLocalMode()).rejects.toThrow(LocalStoreError);

        expect(isLocalMode()).toBe(false);
        expect(files.get(LEGACY)).toBe('{not json');
        expect(sqlite.query(STORED).get()).toEqual({ n: 0 });
    });

    it('refuses a store missing its settings rather than opening on the defaults', async () => {
        await startLocalMode();
        sqlite.exec("DELETE FROM clinic_rows WHERE tbl = 'settings'");
        relaunch();
        await disableLocalMode();

        await expect(startLocalMode()).rejects.toThrow(LocalStoreError);
    });
});

describe('a phone from before the store', () => {
    it('moves its clinic in and never reads the old file again', async () => {
        const db = freshLocalDb();
        db.settings.clinicName = 'Old Phone';
        const old = serializeLocal(db);
        files.set(LEGACY, old);
        files.set('lustre-local.exported', '2026-09-28T08:00:00.000Z');

        await startLocalMode();

        expect((await client.settings.get.query()).clinicName).toBe('Old Phone');
        expect(files.has(LEGACY)).toBe(false);
        expect(files.has('lustre-local.exported')).toBe(false);
        expect(files.get('lustre-local.moved-to-sqlite.json')).toBe(old);

        await client.settings.update.mutate({ clinicName: 'Renamed' });
        relaunch();
        await startLocalMode();
        expect((await client.settings.get.query()).clinicName).toBe('Renamed');
    });

    it('falls back to the next copy when the main file was cut off', async () => {
        const db = freshLocalDb();
        db.settings.clinicName = 'Next Copy';
        files.set(LEGACY, '{cut off');
        files.set('lustre-local.next.json', serializeLocal(db));

        await startLocalMode();

        expect((await client.settings.get.query()).clinicName).toBe('Next Copy');
    });
});

/** Another phone's clinic, before it is exported: one branch of its own and a patient. */
function anotherPhonesClinic() {
    const db = freshLocalDb();
    db.branches[0] = { ...db.branches[0], name: 'Dokki' } as (typeof db.branches)[number];
    db.patients.push({
        id: '0192f000-0000-7000-8000-000000000001',
        ref: '1',
        name: 'Salma Adel',
        phone: '01011112222',
        email: null,
        birthDate: '1988-04-02',
        gender: null,
        custom: {},
        notes: null,
        legacyRef: null,
        createdAt: new Date('2026-09-01T09:00:00.000Z'),
    });
    return db;
}

const EXPORTED_AT = new Date('2026-09-28T08:00:00.000Z');

function anotherPhonesExport(): Uint8Array {
    return clinicSnapshot(anotherPhonesClinic(), EXPORTED_AT);
}

/** A snapshot with whatever the test wants in it, rather than what the app would write. */
function handMadeSnapshot(rows: [string, string, string][], meta: [string, string][]): Uint8Array {
    const snapshot = new Database(':memory:');
    snapshot.exec(LOCAL_CLINIC_TABLES_SQL);
    for (const row of rows) {
        snapshot.query('INSERT INTO clinic_rows (tbl, id, json) VALUES (?, ?, ?)').run(...row);
    }
    for (const row of meta) snapshot.query('INSERT INTO clinic_meta (key, value) VALUES (?, ?)').run(...row);
    return gzipSync(snapshot.serialize());
}

describe('the clinic leaving the phone', () => {
    it('says there is no copy until one has been made', async () => {
        await startLocalMode();

        const status = await client.backup.status.query();

        expect(status.lastSuccessAt).toBeNull();
        expect(status.stale).toBe(true);
    });

    it('writes what the server will read: every table, in the shared format', () => {
        const file = JSON.parse(serializeLocal(seedDemoDb(), new Date()));

        const parsed = localClinicFileSchema.safeParse(file);

        expect(parsed.success ? null : parsed.error.issues.slice(0, 3)).toBeNull();
    });

    // Zod drops a key it does not know, so a column added to the rows and not to
    // the schema would vanish on the way to a server without anything failing.
    it('has every field of every row in the shared format', () => {
        const file = JSON.parse(serializeLocal(seedDemoDb()));
        const parsed = localClinicFileSchema.parse(file);

        for (const [table, rows] of Object.entries(file.db)) {
            const kept = (parsed.db as Record<string, unknown>)[table];
            if (!Array.isArray(rows)) {
                expect(Object.keys(kept as object).sort()).toEqual(Object.keys(rows as object).sort());
                continue;
            }
            rows.forEach((row: object, index: number) => {
                expect(Object.keys((kept as object[])[index] as object).sort()).toEqual(
                    Object.keys(row).sort(),
                );
            });
        }
    });
});

describe('backups to Google Drive', () => {
    async function linkedClinicWithAPatient() {
        await startLocalModeFrom(
            await pickedFromSnapshot(clinicSnapshot(anotherPhonesClinic(), EXPORTED_AT)),
        );
        await linkDrive('refresh', 'access');
        hydrateDriveLink();
    }

    function ageLastBackup(hours: number) {
        sqlite
            .query("UPDATE clinic_meta SET value = ? WHERE key = 'driveBackupAt'")
            .run(new Date(Date.now() - hours * 3_600_000).toISOString());
    }

    it('reports the account and the last backup once linked', async () => {
        await linkedClinicWithAPatient();
        const at = await backUpToDrive();

        const status = await client.backup.status.query();

        expect(status.offsite.configured).toBe(true);
        expect(status.offsite.account).toBe('clinic@example.com');
        expect(status.lastSuccessAt).toBe(at.toISOString());
        expect(status.staleAfterHours).toBe(48);
    });

    // A cold launch of a phone already in local mode never calls `startLocalMode`.
    it('still knows it is linked after a cold launch', async () => {
        await linkedClinicWithAPatient();
        const at = await backUpToDrive();

        relaunch();
        noteDriveLink(null);
        noteLastDriveBackupAt(null);

        const status = await client.backup.status.query();
        expect(status.offsite.configured).toBe(true);
        expect(status.offsite.account).toBe('clinic@example.com');
        expect(status.lastSuccessAt).toBe(at.toISOString());
    });

    it('backs up into the hidden folder, and that backup opens as the clinic', async () => {
        await linkedClinicWithAPatient();

        await backUpToDrive();
        const [backup] = await listDriveBackups();
        expect(backup?.name).toMatch(/^lustre-clinic-\d{4}-\d{2}-\d{2}\.db\.gz$/);

        const picked = await fetchDriveBackup(backup?.id ?? '');
        expect(picked.db.patients.map((row) => row.ref)).toEqual(['1']);
        expect(picked.replaces).toBe(true);
    });

    it('tells the shell the clinic was swapped, so no page stays open on the old one', async () => {
        await linkedClinicWithAPatient();
        await backUpToDrive();
        const [backup] = await listDriveBackups();
        const before = clinicGeneration();

        await startLocalModeFrom(await fetchDriveBackup(backup?.id ?? ''));

        expect(clinicGeneration()).toBe(before + 1);
    });

    it('does not upload a clinic straight back after restoring it', async () => {
        await linkedClinicWithAPatient();

        expect(await backUpIfDue()).toBe(false);
        expect(drive.uploads).toBe(0);
    });

    it('calls an unchanged clinic up to date, however old its backup', async () => {
        await linkedClinicWithAPatient();
        await backUpToDrive();
        ageLastBackup(24 * 30);
        relaunch();

        expect((await client.backup.status.query()).stale).toBe(false);

        await client.branch.create.mutate({ name: 'Second' });
        expect((await client.backup.status.query()).stale).toBe(true);
    });

    it('calls a linked clinic behind when its first backup never made it', async () => {
        await linkedClinicWithAPatient();
        sqlite.exec("DELETE FROM clinic_meta WHERE key = 'driveBackupAt'");
        relaunch();
        drive.down = true;

        await expect(backUpIfDue()).rejects.toThrow();

        const status = await client.backup.status.query();
        expect(status.lastSuccessAt).toBeNull();
        expect(status.stale).toBe(true);
    });

    it('calls a clinic with no Google account behind', async () => {
        await startLocalMode();

        expect((await client.backup.status.query()).stale).toBe(true);
    });

    it('keeps the last fourteen and deletes the oldest', async () => {
        await linkedClinicWithAPatient();

        for (let run = 0; run < 16; run += 1) await backUpToDrive();

        expect(drive.files.map((file) => file.id)).toEqual(
            Array.from({ length: 14 }, (_, index) => `file-${index + 3}`),
        );
    });

    it('is due the first time, then only after a day with something new', async () => {
        await linkedClinicWithAPatient();
        sqlite.exec("DELETE FROM clinic_meta WHERE key = 'driveBackupAt'");

        expect(await backUpIfDue()).toBe(true);
        expect(await backUpIfDue()).toBe(false);

        ageLastBackup(25);
        expect(await backUpIfDue()).toBe(false);

        await client.branch.create.mutate({ name: 'Second' });
        ageLastBackup(23);
        expect(await backUpIfDue()).toBe(false);
        ageLastBackup(25);
        expect(await backUpIfDue()).toBe(true);
        expect(drive.uploads).toBe(2);
    });

    it('still owes the backup after an upload that failed', async () => {
        await linkedClinicWithAPatient();
        await backUpToDrive();
        await client.branch.create.mutate({ name: 'Second' });
        ageLastBackup(25);
        drive.down = true;

        await expect(backUpIfDue()).rejects.toThrow();

        drive.down = false;
        expect(await backUpIfDue()).toBe(true);
    });

    it('does not put an empty clinic over the backups, but will if asked', async () => {
        await startLocalMode();
        await linkDrive('refresh', 'access');

        expect(await backUpIfDue()).toBe(false);
        expect(drive.uploads).toBe(0);

        await backUpToDrive();
        expect(drive.uploads).toBe(1);
    });

    it('asks for a new sign-in when Google has dropped the grant, and stops trying', async () => {
        await linkedClinicWithAPatient();
        drive.grantRevoked = true;

        await expect(backUpToDrive()).rejects.toThrow();

        const status = await client.backup.status.query();
        expect(status.offsite.reauthorizationRequiredSince).not.toBeNull();
        expect(await backUpIfDue()).toBe(false);
    });

    it('deletes every backup and stays linked', async () => {
        await linkedClinicWithAPatient();
        await backUpToDrive();
        await backUpToDrive();

        await deleteDriveBackups();

        expect(drive.files).toEqual([]);
        expect((await client.backup.status.query()).offsite.configured).toBe(true);
    });

    it('unlinks: forgets the grant, revokes it, leaves the backups, and stops', async () => {
        await linkedClinicWithAPatient();
        await backUpToDrive();

        await unlinkDrive();

        expect(secure.size).toBe(0);
        expect(drive.revoked).toEqual(['token=refresh']);
        expect(drive.files).toHaveLength(1);
        expect((await client.backup.status.query()).offsite.configured).toBe(false);
        expect(await backUpIfDue()).toBe(false);
        await expect(backUpToDrive()).rejects.toThrow();
    });

    it('unlinks even when Google cannot be reached', async () => {
        await linkedClinicWithAPatient();
        drive.offline = true;

        await unlinkDrive();

        expect(secure.size).toBe(0);
        expect(await backUpIfDue()).toBe(false);
    });

    it('never writes the refresh token into the clinic or a backup', async () => {
        await linkedClinicWithAPatient();
        await backUpToDrive();

        const stored = JSON.stringify(sqlite.query('SELECT * FROM clinic_meta').all());
        const raw = new TextDecoder().decode(gunzipSync(drive.files[0]?.bytes ?? new Uint8Array()));

        expect(stored).not.toContain('refresh');
        expect(raw).not.toContain('refresh');
    });
});

describe('a clinic file brought back', () => {
    it('opens on a new phone, which becomes its admin', async () => {
        pickable = anotherPhonesExport();

        const picked = await pickClinicFile();
        expect(picked?.replaces).toBe(false);
        if (picked) await startLocalModeFrom(picked);

        expect(isLocalMode()).toBe(true);
        expect(await client.device.me.query()).toMatchObject({ role: 'admin' });
        const branches = await client.branch.list.query({ includeInactive: true });
        expect(branches.map((branch) => branch.name)).toEqual(['Dokki']);
        expect(storedRows('patients')).toHaveLength(1);
        // That copy is still wherever it was saved, so it is this phone's last one too.
        expect((await client.backup.status.query()).lastSuccessAt).toBe('2026-09-28T08:00:00.000Z');
    });

    it('refuses a file that is not a clinic, and changes nothing', async () => {
        await startLocalMode();
        const before = sqlite.query('SELECT * FROM clinic_rows').all();
        pickable = JSON.stringify({ hello: 'world' });

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);

        expect(sqlite.query('SELECT * FROM clinic_rows').all()).toEqual(before);
    });

    it('refuses a file whose rows would not survive the trip, rather than storing them broken', async () => {
        const db = anotherPhonesClinic();
        (db.patients[0] as { createdAt: unknown }).createdAt = 'not-a-date';
        pickable = clinicSnapshot(db, EXPORTED_AT);

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);
    });

    it('refuses a JSON file, a cut-off file and a snapshot of something else', async () => {
        const whole = anotherPhonesExport();
        const refused = [
            serializeLocal(anotherPhonesClinic(), EXPORTED_AT),
            whole.slice(0, whole.length / 2),
            gzipSync(new TextEncoder().encode('not a database')),
            handMadeSnapshot([], [['format', 'something-else']]),
        ];
        for (const file of refused) {
            pickable = file;
            await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);
        }
    });

    it('refuses a newer version and a row in a table it does not know', async () => {
        const settings = JSON.stringify(anotherPhonesClinic().settings);
        const meta: [string, string][] = [
            ['format', 'lustre-local'],
            ['version', '1'],
        ];
        pickable = handMadeSnapshot(
            [['settings', 'settings', settings]],
            [
                ['format', 'lustre-local'],
                ['version', '2'],
            ],
        );
        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);

        pickable = handMadeSnapshot(
            [
                ['settings', 'settings', settings],
                ['invoices', 'a', '{}'],
            ],
            meta,
        );
        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);
    });

    it('refuses a snapshot without settings rather than opening on the defaults', async () => {
        pickable = handMadeSnapshot(
            [],
            [
                ['format', 'lustre-local'],
                ['version', '1'],
            ],
        );

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);
    });

    it('leaves the old clinic whole when the phone would not take the new one', async () => {
        pickable = anotherPhonesExport();
        const first = await pickClinicFile();
        if (first) await startLocalModeFrom(first);
        await disableLocalMode();

        pickable = clinicSnapshot(freshLocalDb(), new Date());
        const second = await pickClinicFile();
        writesFail = true;
        await expect(second ? startLocalModeFrom(second) : Promise.resolve()).rejects.toThrow();
        writesFail = false;

        expect(storedRows('patients')).toHaveLength(1);
        relaunch();
        await startLocalMode();
        const branches = await client.branch.list.query({ includeInactive: true });
        expect(branches.map((branch) => branch.name)).toEqual(['Dokki']);
    });

    it('keeps aside an old clinic file it could not read, before opening over it', async () => {
        files.set(LEGACY, '{cut off');
        pickable = anotherPhonesExport();

        const picked = await pickClinicFile();
        expect(picked?.replaces).toBe(true);
        if (picked) await startLocalModeFrom(picked);

        expect(files.get('lustre-local.replaced.json')).toBe('{cut off');
        expect(storedRows('patients')).toHaveLength(1);
    });

    it('says when it would replace a clinic with patients, and keeps that one aside', async () => {
        pickable = anotherPhonesExport();
        const first = await pickClinicFile();
        if (first) await startLocalModeFrom(first);
        await disableLocalMode();

        pickable = clinicSnapshot(freshLocalDb(), new Date());
        const second = await pickClinicFile();
        expect(second?.replaces).toBe(true);
        if (second) await startLocalModeFrom(second);

        expect(storedRows('patients')).toEqual([]);
        expect(parseLocal(String(files.get('lustre-local.replaced.json'))).patients).toHaveLength(1);
    });
});
