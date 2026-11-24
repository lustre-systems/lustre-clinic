import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SavedSchedule } from './savedSchedule';

const stored = new Map<string, string>();
let writeFails = false;

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) =>
            writeFails ? Promise.reject(new Error('storage')) : Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

const { createSavedScheduleStore } = await import('./savedScheduleStore');

const SCHEDULE: SavedSchedule = { version: 1, server: 's', savedAt: 5, branches: [], days: [] };

async function launch() {
    const store = createSavedScheduleStore();
    store.subscribe(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    return store;
}

beforeEach(() => {
    stored.clear();
    writeFails = false;
});

describe('savedScheduleStore', () => {
    it('is empty on a phone that never saved one', async () => {
        expect((await launch()).getSnapshot()).toBeNull();
    });

    it('comes back on the next launch', async () => {
        await (await launch()).save(SCHEDULE);
        expect(JSON.parse((await launch()).getSnapshot() ?? 'null')).toEqual(SCHEDULE);
    });

    it('keeps the copy on disk when a write fails', async () => {
        await (await launch()).save(SCHEDULE);
        writeFails = true;
        await (await launch()).save({ ...SCHEDULE, savedAt: 9 });
        expect(JSON.parse((await launch()).getSnapshot() ?? 'null').savedAt).toBe(5);
    });

    it('does not let a late read overwrite a fresh save', async () => {
        stored.set('lustre.savedSchedule', JSON.stringify({ ...SCHEDULE, savedAt: 1 }));
        const store = createSavedScheduleStore();
        store.subscribe(() => undefined);
        await store.save(SCHEDULE);
        await Promise.resolve();
        expect(JSON.parse(store.getSnapshot() ?? 'null').savedAt).toBe(5);
    });
});
