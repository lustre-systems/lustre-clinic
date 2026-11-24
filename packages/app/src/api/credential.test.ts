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
mock.module('./config', () => ({ BUILD_VARIANT: 'dev' }));

const { createCredentialStore, refusalIn } = await import('./credential');

const doctor = { token: 'tok-doctor', deviceId: 'dev-1', role: 'doctor' as const, label: 'Surgery' };

let demo = false;

async function launch() {
    const store = createCredentialStore(() => (demo ? 'demo' : null));
    store.subscribe(() => {});
    await store.hydrate();
    return store;
}

beforeEach(() => {
    stored.clear();
    demo = false;
});

describe('the credential', () => {
    it('survives a cold launch', async () => {
        (await launch()).grant(doctor);

        const next = await launch();
        expect(next.getSnapshot().credential).toEqual(doctor);
        expect(next.token()).toBe('tok-doctor');
    });

    it('is kept apart from the demo’s', async () => {
        const store = await launch();
        store.grant(doctor);

        demo = true;
        expect(store.token()).toBeNull();
        store.grant({ ...doctor, token: 'tok-demo', role: 'admin' });

        demo = false;
        expect(store.token()).toBe('tok-doctor');
    });

    it('a revoked phone forgets its credential and stays refused across launches', async () => {
        const store = await launch();
        store.grant(doctor);
        store.refuse('revoked', 'tok-doctor');

        const next = await launch();
        expect(next.getSnapshot()).toMatchObject({ credential: null, refusal: 'revoked' });
    });

    it('a new code clears the refusal', async () => {
        const store = await launch();
        store.refuse('revoked', null);
        store.grant(doctor);
        expect(store.getSnapshot().refusal).toBe('none');
    });

    it('ignores a refusal meant for a credential it has since replaced', async () => {
        const store = await launch();
        store.grant(doctor);
        store.refuse('revoked', 'tok-older');
        expect(store.getSnapshot().credential).toEqual(doctor);
    });

    it('does not remember being unprovisioned: turning the requirement off is enough', async () => {
        const store = await launch();
        store.refuse('unprovisioned', null);
        expect(store.getSnapshot().refusal).toBe('unprovisioned');

        const next = await launch();
        expect(next.getSnapshot().refusal).toBe('none');
    });
});

describe('a new install', () => {
    it('asks for a code until one is redeemed, across launches', async () => {
        const store = await launch();
        await store.markFresh();
        expect(store.getSnapshot().refusal).toBe('new');

        const next = await launch();
        expect(next.getSnapshot().refusal).toBe('new');
        next.grant(doctor);
        expect(next.getSnapshot().refusal).toBe('none');
        expect((await launch()).getSnapshot().refusal).toBe('none');
    });

    it('never marks a phone that already has a credential', async () => {
        (await launch()).grant(doctor);
        const store = createCredentialStore(() => (demo ? 'demo' : null));
        await store.markFresh();
        expect(store.getSnapshot()).toMatchObject({ credential: doctor, refusal: 'none' });
    });
});

describe('reading a refusal off a response', () => {
    const error = (appCode: string) => ({ error: { data: { appCode } } });

    it('finds it in a batch', () => {
        expect(refusalIn([{ result: {} }, error('DEVICE_NOT_PROVISIONED')])).toBe('unprovisioned');
        expect(refusalIn([error('DEVICE_NOT_PROVISIONED'), error('DEVICE_REVOKED')])).toBe('revoked');
    });

    it('ignores every other failure', () => {
        expect(refusalIn(error('ROLE_FORBIDDEN'))).toBeNull();
        expect(refusalIn(null)).toBeNull();
    });
});
