import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';
import { BUILD_VARIANT } from '../config';
import { noteDataReset } from '../dataReset';
import { allowsDemo } from '../variant';

const DEMO_KEY = 'lustre.demo';
const LOCAL_KEY = 'lustre.local';

interface DemoExtra {
    demo?: unknown;
}

const extra = (Constants.expoConfig?.extra ?? {}) as DemoExtra;

const shipped = extra.demo === true;

export type DeviceBackend = 'demo' | 'local';

interface BackendState {
    hydrated: boolean;
    backend: DeviceBackend | null;
}

let state: BackendState = { hydrated: shipped, backend: shipped ? 'demo' : null };

const listeners = new Set<() => void>();
let hydrating = false;

let transitions = 0;

function emit(next: BackendState): void {
    if (next.hydrated === state.hydrated && next.backend === state.backend) return;
    state = next;
    for (const listener of listeners) listener();
}

function become(backend: DeviceBackend | null): void {
    transitions += 1;
    const changed = state.backend !== backend;
    emit({ hydrated: true, backend });
    if (changed) noteDataReset();
}

export function isDemoMode(): boolean {
    return state.backend === 'demo';
}

export function isLocalMode(): boolean {
    return state.backend === 'local';
}

export function deviceBackend(): DeviceBackend | null {
    return state.backend;
}

function getSnapshot(): BackendState {
    return state;
}

async function hydrate(): Promise<void> {
    const before = transitions;
    const [demo, local] = await Promise.all(
        [DEMO_KEY, LOCAL_KEY].map((key) => AsyncStorage.getItem(key).catch(() => null)),
    );
    if (!allowsDemo(BUILD_VARIANT)) await AsyncStorage.removeItem(DEMO_KEY).catch(() => undefined);
    if (transitions !== before) return;

    const demoOn = allowsDemo(BUILD_VARIANT) && (shipped || demo === 'on');
    const backend: DeviceBackend | null = shipped
        ? 'demo'
        : local === 'on'
          ? 'local'
          : demoOn
            ? 'demo'
            : null;
    emit({ hydrated: true, backend });
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!hydrating) {
        hydrating = true;
        void hydrate();
    }
    return () => {
        listeners.delete(listener);
    };
}

export function useDeviceBackend(): BackendState {
    return useSyncExternalStore(subscribe, getSnapshot);
}

export interface DemoMode {
    hydrated: boolean;
    enabled: boolean;
    enable: () => Promise<void>;
    disable: () => Promise<void>;
}

export function useDemoMode(): DemoMode {
    const current = useDeviceBackend();
    return {
        hydrated: current.hydrated,
        enabled: current.backend === 'demo',
        enable: enableDemoMode,
        disable: disableDemoMode,
    };
}

function clearKey(key: string): Promise<void> {
    return AsyncStorage.removeItem(key)
        .catch(() => AsyncStorage.setItem(key, 'off'))
        .catch(() => undefined);
}

export async function enableDemoMode(): Promise<void> {
    if (!allowsDemo(BUILD_VARIANT) || state.backend === 'local') return;
    become('demo');
    await AsyncStorage.setItem(DEMO_KEY, 'on').catch(() => undefined);
}

export async function disableDemoMode(): Promise<void> {
    if (shipped || state.backend !== 'demo') return;
    become(null);
    await clearKey(DEMO_KEY);
}

export async function enableLocalMode(): Promise<void> {
    if (shipped) return;
    await AsyncStorage.setItem(LOCAL_KEY, 'on');
    await clearKey(DEMO_KEY);
    become('local');
}

export async function disableLocalMode(): Promise<void> {
    if (state.backend !== 'local') return;
    become(null);
    await clearKey(LOCAL_KEY);
}
