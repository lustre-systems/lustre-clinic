/**
 * The demo's role lives in two places: the device row in the demo database and
 * the token in the phone's credential slot. When the database is seeded anew —
 * nothing stored, or a version the phone no longer reads — the row is gone, and
 * a kept token would be refused as withdrawn. That refusal persists, and "Enter
 * demo mode" cannot clear it because the phone is already in the demo.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

mock.module('expo-constants', () => ({ default: { expoConfig: { extra: { demo: false } } } }));

mock.module('../config', () => ({ BUILD_VARIANT: 'dev' }));

// Local mode's file sits behind the same imports; the demo never touches it.
mock.module('expo-file-system', () => ({ File: class {}, Paths: { document: 'documents' } }));

const { createTRPCClient } = await import('@trpc/client');
const { demoLink } = await import('./link');
const { becomeInDemo } = await import('./index');
const { enableDemoMode } = await import('./flag');
const { setDb } = await import('./db');
const { freshLocalDb } = await import('./localFormat');
const { credentialToken } = await import('../credential');

import type { AppRouter } from '@lustre/server/src/trpc/router.ts';

const client = createTRPCClient<AppRouter>({ links: [demoLink] });

/** A launch: no demo database in memory, so the next request opens one. */
function relaunch(): void {
    setDb(freshLocalDb(), 'local');
}

beforeEach(() => {
    stored.clear();
    relaunch();
});

describe('a demo seeded anew', () => {
    it('drops the role the last seed gave, rather than refusing it as withdrawn', async () => {
        await enableDemoMode();
        await becomeInDemo('admin');
        expect(credentialToken()).not.toBeNull();

        stored.delete('lustre.demo.db');
        relaunch();

        await expect(client.branch.list.query()).resolves.toBeDefined();
        expect(credentialToken()).toBeNull();
        expect(JSON.parse(stored.get('lustre.demo.device') ?? '{}').revoked).toBe(false);
    });
});
