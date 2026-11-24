import { joinLinkOf } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: listens for the links Android opens the app with — a native event source
import { useEffect, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';

export interface PendingJoin {
    code: string;
    server: string | null;
}

let pending: PendingJoin | null = null;
const listeners = new Set<() => void>();

function set(next: PendingJoin | null): void {
    pending = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function receive(url: string | null): void {
    const join = url ? joinLinkOf(url) : null;
    if (join) set(join);
}

export function useJoinLinks(): void {
    useEffect(() => {
        void Linking.getInitialURL()
            .then(receive)
            .catch(() => undefined);
        const subscription = Linking.addEventListener('url', ({ url }) => receive(url));
        return () => subscription.remove();
    }, []);
}

export function usePendingJoin(): PendingJoin | null {
    return useSyncExternalStore(subscribe, () => pending);
}

export function clearPendingJoin(): void {
    set(null);
}
