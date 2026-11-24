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
