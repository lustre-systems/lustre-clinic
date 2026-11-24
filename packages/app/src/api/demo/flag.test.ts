import { beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();
let removeFails = false;

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) =>
            removeFails ? Promise.reject(new Error('storage')) : Promise.resolve(void stored.delete(key)),
        multiGet: () => Promise.resolve([]),
        multiSet: () => Promise.resolve(),
    },
}));

mock.module('expo-constants', () => ({ default: { expoConfig: { extra: { demo: false } } } }));

mock.module('../config', () => ({ BUILD_VARIANT: 'dev' }));

const demo = await import('./flag');

beforeEach(() => {
    stored.clear();
    removeFails = false;
});

describe('leaving demo mode', () => {
    it('puts a phone that chose the demo back on its clinic', async () => {
        await demo.enableDemoMode();
        expect(demo.isDemoMode()).toBe(true);
        expect(stored.get('lustre.demo')).toBe('on');

        await demo.disableDemoMode();

        expect(demo.isDemoMode()).toBe(false);
        expect(stored.has('lustre.demo')).toBe(false);
    });

    it('does not come back on the next launch when the key cannot be removed', async () => {
        await demo.enableDemoMode();
        removeFails = true;

        await demo.disableDemoMode();

        expect(stored.get('lustre.demo')).not.toBe('on');
    });
});
