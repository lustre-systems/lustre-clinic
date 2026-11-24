import { beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();
let readFails = false;
let writeFails = false;

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) =>
            readFails ? Promise.reject(new Error('storage')) : Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) =>
            writeFails ? Promise.reject(new Error('storage')) : Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

const { createAlarmStore } = await import('./alarmStore');

async function launch() {
    const store = createAlarmStore();
    store.subscribe(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    return store;
}

beforeEach(() => {
    stored.clear();
    readFails = false;
    writeFails = false;
});

describe('alarmStore', () => {
    it('starts unhydrated and off', () => {
        expect(createAlarmStore().getSnapshot()).toEqual({ hydrated: false, enabled: false });
    });

    it('is off on a phone that never chose', async () => {
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, enabled: false });
    });

    it('turns on at once and stays on across a launch', async () => {
        const store = await launch();
        store.set(true);
        expect(store.getSnapshot()).toEqual({ hydrated: true, enabled: true });
        expect(stored.get('lustre.reminderAlarm')).toBe('on');
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, enabled: true });
    });

    it('turns back off', async () => {
        stored.set('lustre.reminderAlarm', 'on');
        const store = await launch();
        store.set(false);
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, enabled: false });
    });

    it('treats a garbled or failed read as off', async () => {
        stored.set('lustre.reminderAlarm', 'yes');
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, enabled: false });

        readFails = true;
        expect((await launch()).getSnapshot()).toEqual({ hydrated: true, enabled: false });
    });

    it('keeps a choice made while the read was still out', async () => {
        stored.set('lustre.reminderAlarm', 'off');
        const store = createAlarmStore();
        store.subscribe(() => undefined);
        store.set(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(store.getSnapshot()).toEqual({ hydrated: true, enabled: true });
    });

    it('puts the switch back when the write does not land', async () => {
        stored.set('lustre.reminderAlarm', 'on');
        const store = await launch();
        writeFails = true;
        store.set(false);
        expect(store.getSnapshot().enabled).toBe(false);
        await Promise.resolve();
        await Promise.resolve();
        expect(store.getSnapshot()).toEqual({ hydrated: true, enabled: true });
        expect(stored.get('lustre.reminderAlarm')).toBe('on');
    });
});
