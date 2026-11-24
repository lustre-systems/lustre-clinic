import { ERROR_CODE, type Role } from '@lustre/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { noteDataReset, subscribeToDataReset } from './dataReset';
import { type DeviceBackend, deviceBackend } from './demo/flag';

export interface Credential {
    token: string;
    deviceId: string;
    role: Role;
    label: string;
}

export type Refusal = 'none' | 'new' | 'unprovisioned' | 'revoked';

export interface CredentialState {
    hydrated: boolean;
    credential: Credential | null;
    refusal: Refusal;
}

interface Slot {
    credential: Credential | null;
    revoked: boolean;
    unprovisioned: boolean;
    fresh: boolean;
}

type SlotName = 'live' | DeviceBackend;

const SLOTS: readonly SlotName[] = ['live', 'demo', 'local'];

const KEYS: Record<SlotName, string> = {
    live: 'lustre.device',
    demo: 'lustre.demo.device',
    local: 'lustre.local.device',
};

const EMPTY: Slot = { credential: null, revoked: false, unprovisioned: false, fresh: false };

function parseSlot(stored: string | null): Slot {
    if (!stored) return EMPTY;
    try {
        const value = JSON.parse(stored) as Partial<{
            credential: Credential | null;
            revoked: boolean;
            fresh: boolean;
        }>;
        const credential = value.credential;
        const valid =
            credential &&
            typeof credential.token === 'string' &&
            typeof credential.deviceId === 'string' &&
            typeof credential.role === 'string';
        return {
            credential: valid ? credential : null,
            revoked: value.revoked === true,
            unprovisioned: false,
            fresh: value.fresh === true,
        };
    } catch {
        return EMPTY;
    }
}

export function refusalIn(body: unknown): 'revoked' | 'unprovisioned' | null {
    const entries = Array.isArray(body) ? body : [body];
    let found: 'revoked' | 'unprovisioned' | null = null;
    for (const entry of entries) {
        const code = (entry as { error?: { data?: { appCode?: unknown } } } | null)?.error?.data?.appCode;
        if (code === ERROR_CODE.DEVICE_REVOKED) return 'revoked';
        if (code === ERROR_CODE.DEVICE_NOT_PROVISIONED) found = 'unprovisioned';
    }
    return found;
}

export function createCredentialStore(backend: () => DeviceBackend | null = deviceBackend) {
    const slots: Record<SlotName, Slot> = { live: EMPTY, demo: EMPTY, local: EMPTY };
    let hydrated = false;
    let snapshot: CredentialState = { hydrated: false, credential: null, refusal: 'none' };
    const listeners = new Set<() => void>();
    const current = (): SlotName => backend() ?? 'live';

    function emit(): void {
        const slot = slots[current()];
        const refusal: Refusal = slot.revoked
            ? 'revoked'
            : slot.unprovisioned
              ? 'unprovisioned'
              : slot.fresh && !slot.credential
                ? 'new'
                : 'none';
        const next = { hydrated, credential: slot.credential, refusal };
        if (
            next.hydrated === snapshot.hydrated &&
            next.credential === snapshot.credential &&
            next.refusal === snapshot.refusal
        ) {
            return;
        }
        snapshot = next;
        for (const listener of listeners) listener();
    }

    const touched = new Set<SlotName>();

    function write(name: SlotName, slot: Slot): void {
        slots[name] = slot;
        touched.add(name);
        const persisted = JSON.stringify({
            credential: slot.credential,
            revoked: slot.revoked,
            fresh: slot.fresh,
        });
        void AsyncStorage.setItem(KEYS[name], persisted).catch(() => undefined);
        emit();
    }

    let hydrating: Promise<void> | null = null;

    function hydrate(): Promise<void> {
        hydrating ??= (async () => {
            const stored = await Promise.all(
                SLOTS.map((name) => AsyncStorage.getItem(KEYS[name]).catch(() => null)),
            );
            SLOTS.forEach((name, index) => {
                if (!touched.has(name)) slots[name] = parseSlot(stored[index] ?? null);
            });
            hydrated = true;
            emit();
        })();
        return hydrating;
    }

    subscribeToDataReset(emit);

    return {
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            void hydrate();
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot: (): CredentialState => snapshot,
        hydrate,
        token: (): string | null => slots[current()].credential?.token ?? null,
        grant(credential: Credential): void {
            write(current(), { credential, revoked: false, unprovisioned: false, fresh: false });
        },
        refuse(kind: 'revoked' | 'unprovisioned', sentWith: string | null): void {
            const name = current();
            const slot = slots[name];
            if ((slot.credential?.token ?? null) !== sentWith) return;
            if (kind === 'revoked') {
                write(name, { credential: null, revoked: true, unprovisioned: false, fresh: false });
                return;
            }
            if (slot.credential || slot.unprovisioned) return;
            slots[name] = { ...slot, unprovisioned: true };
            emit();
        },
        retry(): void {
            const name = current();
            slots[name] = { ...slots[name], unprovisioned: false };
            emit();
        },
        forgetDemo(): void {
            write('demo', EMPTY);
        },
        forgetLive(): void {
            write('live', { ...EMPTY, fresh: true });
        },
        async markFresh(): Promise<void> {
            await hydrate();
            const slot = slots.live;
            if (slot.credential || slot.fresh) return;
            write('live', { ...slot, fresh: true });
        },
    };
}

const store = createCredentialStore();

export function useCredential(): CredentialState {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function credentialToken(): string | null {
    return store.token();
}

export function hydrateCredential(): Promise<void> {
    return store.hydrate();
}

export function grantCredential(credential: Credential): void {
    store.grant(credential);
    noteDataReset();
}

export function noteRefusal(kind: 'revoked' | 'unprovisioned', sentWith: string | null): void {
    const before = store.getSnapshot();
    store.refuse(kind, sentWith);
    if (store.getSnapshot().credential !== before.credential) noteDataReset();
}

export function retryProvisioning(): void {
    store.retry();
    noteDataReset();
}

export function markFreshInstall(): Promise<void> {
    return store.markFresh();
}

export function forgetServerCredential(): void {
    store.forgetLive();
    noteDataReset();
}

export function forgetDemoCredential(): void {
    store.forgetDemo();
}
