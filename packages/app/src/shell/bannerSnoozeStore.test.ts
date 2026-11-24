import { beforeEach, describe, expect, it, jest, mock, onTestFinished } from 'bun:test';

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

const { createSnoozeStore, SNOOZE_MS } = await import('./bannerSnoozeStore');

const KEY = 'test.snoozedUntil';
let clock = 1_000_000;

async function launch() {
    const store = createSnoozeStore(KEY, () => clock);
    store.subscribe(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    return store;
}

beforeEach(() => {
    stored.clear();
    readFails = false;
    clock = 1_000_000;
});

describe('bannerSnoozeStore', () => {
    it('starts unhydrated and not snoozed', () => {
        expect(createSnoozeStore(KEY).getSnapshot()).toEqual({ hydrated: false, snoozed: false });
    });

    it('snoozes at once and writes when it ends', async () => {
        const store = await launch();
        store.snooze();
        expect(store.getSnapshot()).toEqual({ hydrated: true, snoozed: true });
        expect(stored.get(KEY)).toBe(String(clock + SNOOZE_MS));
    });

    it('keeps a snooze that has not run out across a launch', async () => {
        stored.set(KEY, String(clock + 60_000));
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, snoozed: true });
    });

    it('shows again once the snooze has run out', async () => {
        stored.set(KEY, String(clock - 1));
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, snoozed: false });
    });

    it('comes back by itself when the snooze ends with the app open', async () => {
        jest.useFakeTimers();
        onTestFinished(() => jest.useRealTimers());
        stored.set(KEY, String(clock + 5));
        const store = await launch();
        expect(store.getSnapshot().snoozed).toBe(true);
        clock += 5;
        jest.advanceTimersByTime(5);
        expect(store.getSnapshot()).toEqual({ hydrated: true, snoozed: false });
    });

    it('treats a missing, garbled or failed read as not snoozed', async () => {
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, snoozed: false });

        stored.set(KEY, 'soon');
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, snoozed: false });

        readFails = true;
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, snoozed: false });
    });
});
