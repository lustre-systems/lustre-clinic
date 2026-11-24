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

const { createRoleStore, resolveRole } = await import('./roleStore');

async function launch() {
    const store = createRoleStore();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().role));
    await Promise.resolve();
    await Promise.resolve();
    return { store, seen };
}

beforeEach(() => {
    stored.clear();
    readFails = false;
    writeFails = false;
});

describe('the role a launch opens in', () => {
    it('holds nothing role-specific until storage has answered', () => {
        const store = createRoleStore();
        expect(store.getSnapshot().hydrated).toBe(false);
    });

    it('reopens the doctor view for a phone last used as the doctor', async () => {
        stored.set('lustre.role', 'doctor');

        const { store } = await launch();

        expect(store.getSnapshot()).toEqual({ hydrated: true, role: 'doctor' });
    });

    it('reopens the secretary view for a phone last used as the secretary', async () => {
        stored.set('lustre.role', 'secretary');

        const { store } = await launch();

        expect(store.getSnapshot()).toEqual({ hydrated: true, role: 'secretary' });
    });

    it('opens as the secretary when nothing has been stored yet', async () => {
        const { store } = await launch();

        expect(store.getSnapshot()).toEqual({ hydrated: true, role: 'secretary' });
    });

    it('opens as the secretary on a value it does not recognise', async () => {
        stored.set('lustre.role', 'Doctor ');

        const { store } = await launch();

        expect(store.getSnapshot().role).toBe('secretary');
    });

    it('opens as the secretary, hydrated, when the read throws', async () => {
        stored.set('lustre.role', 'doctor');
        readFails = true;

        const { store } = await launch();

        expect(store.getSnapshot()).toEqual({ hydrated: true, role: 'secretary' });
    });

    it('never passes through the doctor view on its way to the secretary', async () => {
        const { seen } = await launch();

        expect(seen).not.toContain('doctor');
    });
});

describe('a provisioned phone', () => {
    const legacy = { hydrated: true, role: 'secretary' as const };
    const admin = { hydrated: true, role: 'doctor' as const };
    const credential = { token: 't', deviceId: 'd', role: 'admin' as const, label: 'Owner' };

    it('draws the view of the role it was granted, whatever it was left on', () => {
        expect(resolveRole(legacy, admin, credential, true)).toEqual({
            hydrated: true,
            role: 'doctor',
            granted: 'admin',
        });
    });

    it('lets the admin look at the desk’s day, still as the admin', () => {
        const desk = { hydrated: true, role: 'secretary' as const };
        expect(resolveRole(legacy, desk, credential, true)).toEqual({
            hydrated: true,
            role: 'secretary',
            granted: 'admin',
        });
    });

    it('does not let anyone but the admin choose', () => {
        const doctor = { ...credential, role: 'doctor' as const };
        const desk = { hydrated: true, role: 'secretary' as const };
        expect(resolveRole(legacy, desk, doctor, true).role).toBe('doctor');
    });

    it('keeps the view it was left on until it scans a code', () => {
        expect(resolveRole(legacy, admin, null, true)).toEqual({
            hydrated: true,
            role: 'secretary',
            granted: null,
        });
    });

    it('holds nothing role-specific until the credential has been read too', () => {
        expect(resolveRole(legacy, admin, null, false).hydrated).toBe(false);
    });
});

describe('the admin’s view', () => {
    it('opens on the doctor’s day, and remembers a switch', async () => {
        const first = createRoleStore('lustre.admin.view', 'doctor');
        first.subscribe(() => {});
        await Promise.resolve();
        await Promise.resolve();
        expect(first.getSnapshot().role).toBe('doctor');

        first.set('secretary');
        const second = createRoleStore('lustre.admin.view', 'doctor');
        second.subscribe(() => {});
        await Promise.resolve();
        await Promise.resolve();
        expect(second.getSnapshot().role).toBe('secretary');
    });
});
