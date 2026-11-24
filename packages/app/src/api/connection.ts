import { AppState, type NativeEventSubscription } from 'react-native';
import { noteConnection } from '../reporting/trail';
import { BUILD_VARIANT, serverAddresses, timing, trpcUrl } from './config';
import { deviceBackend } from './demo';
import { acceptsServer } from './variant';

export type ConnectionStatus = 'unknown' | 'probing' | 'online' | 'offline';

export type AddressKind = 'lan' | 'tailscale';

export interface ConnectionState {
    status: ConnectionStatus;
    baseUrl: string | null;
    address: AddressKind | null;
    lastOnlineAt: number | null;
    isStale: boolean;
}

export class ServerUnreachableError extends Error {
    constructor(message = 'The clinic server did not answer on either address') {
        super(message);
        this.name = 'ServerUnreachableError';
    }
}

let state: ConnectionState = {
    status: 'unknown',
    baseUrl: null,
    address: null,
    lastOnlineAt: null,
    isStale: true,
};

const listeners = new Set<() => void>();
let staleTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: Partial<ConnectionState>): void {
    const merged = { ...state, ...next };
    if (
        merged.status === state.status &&
        merged.baseUrl === state.baseUrl &&
        merged.address === state.address &&
        merged.lastOnlineAt === state.lastOnlineAt &&
        merged.isStale === state.isStale
    ) {
        return;
    }
    if (merged.status !== state.status) noteConnection(merged.status);
    state = merged;
    for (const listener of listeners) listener();
}

function armStaleTimer(): void {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => emit({ isStale: true }), timing.staleAfterMs);
}

const onDevice = (): boolean => deviceBackend() !== null;

const DEMO_STATE: ConnectionState = {
    status: 'online',
    baseUrl: null,
    address: null,
    lastOnlineAt: Date.now(),
    isStale: false,
};

export function getConnectionState(): ConnectionState {
    return onDevice() ? DEMO_STATE : state;
}

export function subscribeToConnection(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) startForegroundWatch();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopForegroundWatch();
    };
}

export function markOnline(): void {
    armStaleTimer();
    emit({ status: 'online', lastOnlineAt: Date.now(), isStale: false });
}

export function markOffline(): void {
    emit({ status: 'offline', baseUrl: null, address: null, isStale: true });
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const caller = init?.signal;
    const forward = () => controller.abort();
    caller?.addEventListener('abort', forward);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
        caller?.removeEventListener('abort', forward);
    }
}

let refused = false;

export function lastProbeRefused(): boolean {
    return refused;
}

async function probe(base: string, timeoutMs: number): Promise<boolean> {
    try {
        const response = await fetchWithTimeout(`${trpcUrl(base)}/health.check`, timeoutMs);
        if (!response.ok) return false;
        if (BUILD_VARIANT !== 'dev') return true;
        const body = (await response.json().catch(() => null)) as {
            result?: { data?: { environment?: unknown } };
        } | null;
        if (acceptsServer(BUILD_VARIANT, body?.result?.data?.environment)) return true;
        refused = true;
        return false;
    } catch {
        return false;
    }
}

let inFlight: Promise<string> | null = null;

async function probeBoth(): Promise<string> {
    const { lan, tailscale } = serverAddresses();
    refused = false;
    emit({ status: 'probing' });

    if (lan && (await probe(lan, timing.lanProbeMs))) {
        armStaleTimer();
        emit({ status: 'online', baseUrl: lan, address: 'lan', lastOnlineAt: Date.now(), isStale: false });
        return lan;
    }

    if (tailscale && (await probe(tailscale, timing.tailscaleProbeMs))) {
        armStaleTimer();
        emit({
            status: 'online',
            baseUrl: tailscale,
            address: 'tailscale',
            lastOnlineAt: Date.now(),
            isStale: false,
        });
        return tailscale;
    }

    markOffline();
    throw new ServerUnreachableError(lan || tailscale ? undefined : 'No server address is configured yet');
}

export function resolveBaseUrl(): Promise<string> {
    if (onDevice()) {
        return Promise.reject(
            new ServerUnreachableError('the app answers from this phone; there is no server'),
        );
    }
    if (state.baseUrl && state.status === 'online') return Promise.resolve(state.baseUrl);
    if (inFlight) return inFlight;

    inFlight = probeBoth().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

export async function reprobe(): Promise<boolean> {
    if (onDevice()) return true;

    emit({ baseUrl: null, address: null });
    try {
        await resolveBaseUrl();
        return true;
    } catch {
        return false;
    }
}

export function noteLinkDropped(): void {
    if (onDevice()) return;
    if (AppState.currentState !== 'active') return;
    if (state.status === 'probing') return;
    void reprobe();
}

let appStateSub: NativeEventSubscription | null = null;

function startForegroundWatch(): void {
    if (appStateSub) return;
    appStateSub = AppState.addEventListener('change', (next) => {
        if (onDevice()) return;
        if (next === 'active' && state.status !== 'online') void reprobe();
    });
}

function stopForegroundWatch(): void {
    appStateSub?.remove();
    appStateSub = null;
}
