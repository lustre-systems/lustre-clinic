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
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();
const files = new Map<string, string>();
let writesFail = false;
/**
 * The two ways Android's overwrite move can stop part way: with the target
 * removed, or with the source copied over it and not yet deleted.
 */
let movesFail: 'target removed' | 'source left behind' | null = null;
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
        if (movesFail === 'target removed') files.delete(target.name);
        if (movesFail === 'source left behind') files.set(target.name, this.textSync());
        if (movesFail) throw new Error('move failed');
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

const MAIN = 'lustre-local.json';

/** A launch: nothing in memory, whatever is in storage and on file. */
function relaunch(): void {
    setDb(freshLocalDb(), 'demo');
}

beforeEach(async () => {
    await disableLocalMode();
    stored.clear();
    files.clear();
    writesFail = false;
    movesFail = null;
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
        expect(files.has(MAIN)).toBe(true);
    });

    it('has a write on file before it answers', async () => {
        await startLocalMode();

        await client.branch.create.mutate({ name: 'Second' });

        const onFile = parseLocal(files.get(MAIN) ?? '');
        expect(onFile.branches.map((branch) => branch.name).sort()).toEqual(['Main', 'Second']);
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

    it('leaves a clinic file it cannot read alone, and does not switch over', async () => {
        files.set(MAIN, '{not json');

        await expect(startLocalMode()).rejects.toThrow(LocalStoreError);

        expect(isLocalMode()).toBe(false);
        expect(files.get(MAIN)).toBe('{not json');
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
        expect(parseLocal(files.get(MAIN) ?? '').patients).toHaveLength(1);
        // That copy is still wherever it was saved, so it is this phone's last one too.
        expect((await client.backup.status.query()).lastSuccessAt).toBe('2026-09-28T08:00:00.000Z');
    });

    it('does nothing when the picker is closed', async () => {
        expect(await pickClinicFile()).toBeNull();
        expect(files.has(MAIN)).toBe(false);
    });

    it('refuses a file that is not a clinic, and changes nothing', async () => {
        await startLocalMode();
        const before = files.get(MAIN);
        pickable = JSON.stringify({ hello: 'world' });

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);

        expect(files.get(MAIN)).toBe(before);
    });

    it('refuses a file whose rows would not survive the trip, rather than storing them broken', async () => {
        const file = JSON.parse(anotherPhonesExport());
        file.db.patients[0].createdAt = 'not-a-date';
        pickable = JSON.stringify(file);

        await expect(pickClinicFile()).rejects.toThrow(LocalStoreError);
    });

    for (const failure of ['target removed', 'source left behind'] as const) {
        it(`puts the old clinic back when the move stops with the ${failure}`, async () => {
            pickable = anotherPhonesExport();
            const first = await pickClinicFile();
            if (first) await startLocalModeFrom(first);
            await disableLocalMode();
            const before = files.get(MAIN);

            pickable = serializeLocal(freshLocalDb(), new Date());
            const second = await pickClinicFile();
            movesFail = failure;
            await expect(second ? startLocalModeFrom(second) : Promise.resolve()).rejects.toThrow();
            movesFail = null;

            expect(files.get(MAIN)).toBe(before);
            relaunch();
            await startLocalMode();
            const branches = await client.branch.list.query({ includeInactive: true });
            expect(branches.map((branch) => branch.name)).toEqual(['Dokki']);
        });
    }

    it('keeps aside a clinic that was only ever on file as its next copy', async () => {
        const half = serializeLocal(freshLocalDb());
        files.set('lustre-local.next.json', half);
        pickable = anotherPhonesExport();

        const picked = await pickClinicFile();
        if (picked) await startLocalModeFrom(picked);

        expect(files.get('lustre-local.replaced.json')).toBe(half);
    });

    it('says when it would replace a clinic with patients, and keeps that one aside', async () => {
        pickable = anotherPhonesExport();
        const first = await pickClinicFile();
        if (first) await startLocalModeFrom(first);
        await disableLocalMode();
        const replaced = files.get(MAIN);

        pickable = serializeLocal(freshLocalDb(), new Date());
        const second = await pickClinicFile();
        expect(second?.replaces).toBe(true);
        if (second) await startLocalModeFrom(second);

        expect(parseLocal(files.get(MAIN) ?? '').patients).toEqual([]);
        expect(files.get('lustre-local.replaced.json')).toBe(replaced);
    });
});
