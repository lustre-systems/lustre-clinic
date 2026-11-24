import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useSyncExternalStore } from 'react';
import {
    allowsLan,
    BUILD_VARIANT,
    forgetServerCredential,
    isTailnetAddress,
    markFreshInstall,
    reprobe,
    type ServerAddresses,
    serverAddresses,
    setServerAddresses,
    trpcClient,
    useDeviceBackend,
} from '../api';
import { hydratingSubscribe } from './hydratingSubscribe';

const STORAGE_PREFIX =
    BUILD_VARIANT === 'dev' && Updates.isEnabled ? 'lustre.ota-dev.server' : 'lustre.server';
const LAN_KEY = `${STORAGE_PREFIX}.lan`;
const TAILSCALE_KEY = `${STORAGE_PREFIX}.tailscale`;

type DefaultProbe = 'probing' | 'reachable' | 'unreachable';

export interface SetupState {
    hydrated: boolean;
    addresses: ServerAddresses;
    stored: boolean;
    defaultProbe: DefaultProbe;
    reconfiguring: boolean;
}

export interface ServerSetup extends SetupState {
    ready: boolean;
    showSetup: boolean;
}

let state: SetupState = {
    hydrated: false,
    addresses: serverAddresses(),
    stored: false,
    defaultProbe: 'probing',
    reconfiguring: false,
};
const listeners = new Set<() => void>();

function emit(next: SetupState): void {
    state = next;
    for (const listener of listeners) listener();
}

export function applyAddresses(next: ServerAddresses): void {
    setServerAddresses({ lan: next.lan ?? '', tailscale: next.tailscale ?? '' });
}

async function hydrate(): Promise<void> {
    const entries = await AsyncStorage.multiGet([LAN_KEY, TAILSCALE_KEY]).catch(() => null);

    const restored: ServerAddresses = { lan: null, tailscale: null };
    for (const [key, value] of entries ?? []) {
        if (key === LAN_KEY) restored.lan = value || null;
        if (key === TAILSCALE_KEY) restored.tailscale = value || null;
    }

    if (!allowsLan(BUILD_VARIANT)) {
        restored.lan = null;
        await AsyncStorage.removeItem(LAN_KEY).catch(() => undefined);
    }

    if (restored.lan || restored.tailscale) {
        applyAddresses(restored);
        const kept = serverAddresses();
        if (kept.lan || kept.tailscale) {
            emit({ ...state, hydrated: true, addresses: kept, stored: true });
            return;
        }
    }

    void markFreshInstall();

    const fallback = serverAddresses();
    emit({ ...state, hydrated: true, addresses: fallback, stored: false });

    if (!fallback.lan && !fallback.tailscale) {
        emit({ ...state, defaultProbe: 'unreachable' });
        return;
    }

    const reachable = await reprobe();
    if (!reachable) {
        emit({ ...state, defaultProbe: 'unreachable' });
        return;
    }

    await saveServerAddresses({ lan: fallback.lan, tailscale: await learnTailnetAddress() });
    emit({ ...state, defaultProbe: 'reachable' });
}

export async function learnTailnetAddress(): Promise<string | null> {
    const report = await trpcClient.health.check.query().catch(() => null);
    const reported = report?.tailscale?.trim();
    if (!reported) return null;
    return allowsLan(BUILD_VARIANT) || isTailnetAddress(reported) ? reported : null;
}

const subscribe = hydratingSubscribe(listeners, hydrate);

function getSnapshot(): SetupState {
    return state;
}

export function useServerSetup(): ServerSetup {
    const current = useSyncExternalStore(subscribe, getSnapshot);
    const device = useDeviceBackend();

    if (!device.hydrated) return { ...current, ready: false, showSetup: false };
    if (device.backend) return { ...current, ready: true, showSetup: false };

    const settled = current.stored || current.defaultProbe !== 'probing';
    return {
        ...current,
        ready: current.hydrated && settled,
        showSetup: current.reconfiguring || (!current.stored && current.defaultProbe === 'unreachable'),
    };
}

export function requestReconfigure(): void {
    emit({ ...state, reconfiguring: true });
}

export async function disconnectServer(): Promise<void> {
    applyAddresses({ lan: null, tailscale: null });
    forgetServerCredential();
    emit({
        ...state,
        addresses: serverAddresses(),
        stored: false,
        defaultProbe: 'unreachable',
        reconfiguring: false,
    });
    await AsyncStorage.multiRemove([LAN_KEY, TAILSCALE_KEY]).catch(() => undefined);
}

export async function saveServerAddresses(next: ServerAddresses): Promise<void> {
    applyAddresses(next);
    const addresses = serverAddresses();
    emit({
        ...state,
        hydrated: true,
        addresses,
        stored: true,
        defaultProbe: 'reachable',
        reconfiguring: false,
    });

    await AsyncStorage.multiSet([
        [LAN_KEY, addresses.lan ?? ''],
        [TAILSCALE_KEY, addresses.tailscale ?? ''],
    ]).catch(() => undefined);
}
