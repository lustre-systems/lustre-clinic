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

const stored = new Map<string, string>();
const files = new Map<string, string>();
let writesFail = false;
/** What the next system file picker hands back; null is the picker closed. */
let pickable: string | null = null;
const shared: string[] = [];

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

mock.module('expo-constants', () => ({ default: { expoConfig: { extra: { demo: false } } } }));

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
        return text;
    }

    write(content: string): void {
        if (writesFail) throw new Error('disk full');
        files.set(this.name, content);
    }

    get uri(): string {
        return `file:///${this.name}`;
    }

    text(): Promise<string> {
        return Promise.resolve(this.textSync());
    }

    moveSync(target: MemoryFile): void {
        files.set(target.name, this.textSync());
        files.delete(this.name);
    }

    copySync(target: MemoryFile): void {
        files.set(target.name, this.textSync());
    }

    delete(): void {
        files.delete(this.name);
    }

    static pickFileAsync() {
        if (pickable === null) return Promise.resolve({ canceled: true, result: null });
        files.set('picked.json', pickable);
        return Promise.resolve({ canceled: false, result: new MemoryFile('downloads', 'picked.json') });
    }
}

mock.module('expo-file-system', () => ({
    File: MemoryFile,
    Paths: { document: 'documents', cache: 'cache' },
}));

/** Real SQLite, in memory: the transaction is what these tests are about. */
const sqlite = new Database(':memory:');

mock.module('expo-sqlite', () => ({
    openDatabaseSync: () => ({
        execSync: (source: string) => sqlite.exec(source),
        runSync: (source: string, params: string[] = []) => {
            if (writesFail && !source.startsWith('DELETE')) throw new Error('disk full');
            return sqlite.query(source).run(...params);
        },
        getAllSync: (source: string) => sqlite.query(source).all(),
        getFirstSync: (source: string, params: string[]) => sqlite.query(source).get(...params),
        withTransactionSync: (task: () => void) => sqlite.transaction(task)(),
    }),
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

mock.module('expo-sharing', () => ({
    shareAsync: (uri: string) => Promise.resolve(void shared.push(uri)),
}));

const { createTRPCClient } = await import('@trpc/client');
const { demoLink } = await import('./link');
const { exportLocal, pickClinicFile, startLocalMode, startLocalModeFrom } = await import('./index');
const { disableLocalMode, isLocalMode } = await import('./flag');
const { setDb } = await import('./db');
const { freshLocalDb, LocalStoreError, parseLocal, parseLocalFile, serializeLocal } = await import(
    './localFormat'
);
const { seedDemoDb } = await import('./seed');
const { localClinicFileSchema } = await import('@lustre/shared');
const { credentialToken } = await import('../credential');

import type { AppRouter } from '@lustre/server/src/trpc/router.ts';

const client = createTRPCClient<AppRouter>({ links: [demoLink] });

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
    pickable = null;
    shared.length = 0;
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
    it('moves its clinic in, export time and all, and never reads the old file again', async () => {
        const db = freshLocalDb();
        db.settings.clinicName = 'Old Phone';
        const old = serializeLocal(db);
        files.set(LEGACY, old);
        files.set('lustre-local.exported', '2026-09-28T08:00:00.000Z');

        await startLocalMode();

        expect((await client.settings.get.query()).clinicName).toBe('Old Phone');
        expect((await client.backup.status.query()).lastSuccessAt).toBe('2026-09-28T08:00:00.000Z');
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

/** Another phone's clinic, as its export arrives: one branch of its own and a patient. */
function anotherPhonesExport(exportedAt = new Date('2026-09-28T08:00:00.000Z')): string {
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
    return serializeLocal(db, exportedAt);
}

describe('the clinic leaving the phone', () => {
    it('says there is no copy until one has been made', async () => {
        await startLocalMode();

        const status = await client.backup.status.query();

        expect(status.lastSuccessAt).toBeNull();
        expect(status.stale).toBe(true);
    });

    it('hands the share sheet the whole clinic, stamped, and reports it as the last backup', async () => {
        await startLocalMode();
        await client.branch.create.mutate({ name: 'Second' });

        const at = await exportLocal('Save the clinic file');

        expect(shared).toHaveLength(1);
        const copy = parseLocalFile(files.get(shared[0]?.replace('file:///', '') ?? '') ?? '');
        expect(copy.exportedAt?.toISOString()).toBe(at.toISOString());
        expect(copy.db.branches.map((branch) => branch.name).sort()).toEqual(['Main', 'Second']);
        const status = await client.backup.status.query();
        expect(status.lastSuccessAt).toBe(at.toISOString());
        expect(status.stale).toBe(false);
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

    it('does nothing when the picker is closed', async () => {
        expect(await pickClinicFile()).toBeNull();
        expect(sqlite.query(STORED).get()).toEqual({ n: 0 });
    });

    it('refuses a file that is not a clinic, and changes nothing', async () => {
        await startLocalMode();
        const before = sqlite.query('SELECT * FROM clinic_rows').all();
        pickable = JSON.stringify({ hello: 'world' });

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);

        expect(sqlite.query('SELECT * FROM clinic_rows').all()).toEqual(before);
    });

    it('refuses a file whose rows would not survive the trip, rather than storing them broken', async () => {
        const file = JSON.parse(anotherPhonesExport());
        file.db.patients[0].createdAt = 'not-a-date';
        pickable = JSON.stringify(file);

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);
    });

    it('leaves the old clinic whole when the phone would not take the new one', async () => {
        pickable = anotherPhonesExport();
        const first = await pickClinicFile();
        if (first) await startLocalModeFrom(first);
        await disableLocalMode();

        pickable = serializeLocal(freshLocalDb(), new Date());
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

        pickable = serializeLocal(freshLocalDb(), new Date());
        const second = await pickClinicFile();
        expect(second?.replaces).toBe(true);
        if (second) await startLocalModeFrom(second);

        expect(storedRows('patients')).toEqual([]);
        expect(parseLocal(files.get('lustre-local.replaced.json') ?? '').patients).toHaveLength(1);
    });
});
