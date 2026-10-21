/**
 * Local mode is a real clinic answered from the phone. What it must never do is
 * the thing the demo is allowed to: say a write was saved when the file did not
 * take it, or replace a clinic it could not read with an empty one.
 *
 * The file system is an in-memory stand-in with the two behaviours that matter
 * here — a write that can be made to fail, and a move that replaces the target.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();
const files = new Map<string, string>();
let writesFail = false;

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

    moveSync(target: MemoryFile): void {
        files.set(target.name, this.textSync());
        files.delete(this.name);
    }
}

mock.module('expo-file-system', () => ({ File: MemoryFile, Paths: { document: 'documents' } }));

const { createTRPCClient } = await import('@trpc/client');
const { demoLink } = await import('./link');
const { startLocalMode } = await import('./index');
const { disableLocalMode, isLocalMode } = await import('./flag');
const { setDb } = await import('./db');
const { freshLocalDb, LocalStoreError, parseLocal, serializeLocal } = await import('./localFormat');
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
    relaunch();
});

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
