import type { WsEvent } from '@lustre/shared';

type Listener = (event: WsEvent) => void;

const listeners = new Set<Listener>();

export function subscribeToDemoEvents(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function broadcast(event: WsEvent): void {
    setTimeout(() => {
        for (const listener of listeners) listener(event);
    }, 0);
}
