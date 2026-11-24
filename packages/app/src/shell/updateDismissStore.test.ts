import { beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();
let readFails = false;

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) =>
            readFails ? Promise.reject(new Error('storage')) : Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

const { createDismissStore } = await import('./updateDismissStore');

async function launch() {
    const store = createDismissStore();
    store.subscribe(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    return store;
}

beforeEach(() => {
    stored.clear();
    readFails = false;
});

describe('updateDismissStore', () => {
    it('starts unhydrated with nothing dismissed', () => {
        const store = createDismissStore();
        expect(store.getSnapshot()).toEqual({ hydrated: false, versionCode: null });
    });

    it('remembers the build dismissed on an earlier launch', async () => {
        stored.set('lustre.apkUpdateDismissed', '2281728');
        const store = await launch();
        expect(store.getSnapshot()).toEqual({ hydrated: true, versionCode: 2281728 });
    });

    it('treats a missing, garbled or failed read as nothing dismissed', async () => {
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, versionCode: null });

        stored.set('lustre.apkUpdateDismissed', 'yes');
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, versionCode: null });

        readFails = true;
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, versionCode: null });
    });

    it('dismisses at once and writes the build for the next launch', async () => {
        const store = await launch();
        store.dismiss(2281728);
        expect(store.getSnapshot()).toEqual({ hydrated: true, versionCode: 2281728 });
        await Promise.resolve();
        expect(stored.get('lustre.apkUpdateDismissed')).toBe('2281728');
    });

    it('lets a dismissal made during the read win over the stored value', async () => {
        stored.set('lustre.apkUpdateDismissed', '2269060');
        const store = createDismissStore();
        store.subscribe(() => undefined);
        store.dismiss(2281728);
        await Promise.resolve();
        await Promise.resolve();
        expect(store.getSnapshot().versionCode).toBe(2281728);
    });
});
