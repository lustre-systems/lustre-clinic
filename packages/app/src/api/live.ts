import { DEVICE_TOKEN_HEADER, WS_CLOSE_REFUSED } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: opens the `/ws` socket and closes it on cleanup — the subscription case this hook exists for
import { useEffect } from 'react';
import { noteLive } from '../reporting/trail';
import { api, trpcClient } from './client';
import { timing, wsUrl } from './config';
import { noteLinkDropped, resolveBaseUrl } from './connection';
import { useCredential } from './credential';
import { subscribeToDemoEvents, useDeviceBackend } from './demo';
import { queryClient } from './queryClient';
import { type Area, createEventCursor, createRefreshBatch, type ServerEvent } from './serverEvents';

const cursor = createEventCursor();

const HeaderedWebSocket = WebSocket as unknown as new (
    url: string,
    protocols: null,
    options: { headers: Record<string, string> } | null,
) => WebSocket;

const changeListeners = new Set<(areas: ReadonlySet<Area> | 'all') => void>();

export function onServerChange(listener: (areas: ReadonlySet<Area> | 'all') => void): () => void {
    changeListeners.add(listener);
    return () => {
        changeListeners.delete(listener);
    };
}

const refresh = createRefreshBatch((areas) => {
    if (areas === 'all') {
        void queryClient.invalidateQueries();
    } else {
        for (const area of areas) void queryClient.invalidateQueries(api[area].pathFilter());
    }
    for (const listener of changeListeners) listener(areas);
});

const listeners = new Set<(event: ServerEvent) => void>();

export function onServerEvent(listener: (event: ServerEvent) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function receive(frame: unknown): void {
    const step = cursor.read(frame);
    if (step.outcome !== 'ignored') noteLive(step.event?.event ?? 'hello', step.outcome);
    if (step.resync) refresh('all');
    if (!step.event) return;
    refresh(step.event.event);
    for (const listener of listeners) listener(step.event);
}

function connect(token: string | null): () => void {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay: number = timing.reconnectMinMs;
    let closed = false;

    const schedule = () => {
        if (closed || retry) return;
        retry = setTimeout(() => {
            retry = null;
            void open();
        }, delay);
        delay = Math.min(delay * 2, timing.reconnectMaxMs);
    };

    const open = async () => {
        if (closed) return;

        let base: string;
        try {
            base = await resolveBaseUrl();
        } catch {
            schedule();
            return;
        }
        if (closed) return;

        const next = new HeaderedWebSocket(
            `${wsUrl(base)}${cursor.resumeQuery()}`,
            null,
            token ? { headers: { [DEVICE_TOKEN_HEADER]: `Bearer ${token}` } } : null,
        );
        socket = next;

        next.onopen = () => {
            delay = timing.reconnectMinMs;
        };
        next.onmessage = (message) => {
            let frame: unknown;
            try {
                frame = JSON.parse(String(message.data));
            } catch {
                return;
            }
            receive(frame);
        };
        next.onerror = () => next.close();
        next.onclose = (event) => {
            if (socket === next) socket = null;
            if (closed) return;
            if (event.code === WS_CLOSE_REFUSED) void trpcClient.settings.get.query().catch(() => undefined);
            schedule();
            noteLinkDropped();
        };
    };

    void open();

    return () => {
        closed = true;
        if (retry) clearTimeout(retry);
        socket?.close();
        socket = null;
    };
}

export function useServerEvents(): void {
    const enabled = useDeviceBackend().backend !== null;
    const { hydrated, credential } = useCredential();
    const token = credential?.token ?? null;

    useEffect(() => {
        if (enabled) return subscribeToDemoEvents(refresh);
        return hydrated ? connect(token) : undefined;
    }, [enabled, hydrated, token]);
}
