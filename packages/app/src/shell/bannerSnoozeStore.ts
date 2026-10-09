import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { hydratingSubscribe } from './hydratingSubscribe';

// The day's warning strips (`NotificationsBanner`) can be put away, but only
// for a while. They name something that is still broken — a check-in nobody
// hears — so a dismissal that held for good would be the phone agreeing to
// stay broken. Stored as the instant it ends rather than a flag, so it survives
// a restart and needs no clearing.
//
// Same shape as `updateDismissStore`, one store per banner.
export const SNOOZE_MS = 4 * 60 * 60_000;

export interface SnoozeState {
    /** The banner holds until this: the alternative is a frame of it on a phone that already said not now. */
    hydrated: boolean;
    snoozed: boolean;
}

function parse(stored: string | null): number | null {
    const until = stored === null ? Number.NaN : Number(stored);
    return Number.isSafeInteger(until) && until > 0 ? until : null;
}

/** Exported for the tests, which need the thing a cold launch produces and a clock they can move. */
export function createSnoozeStore(key: string, now: () => number = Date.now) {
    let state: SnoozeState = { hydrated: false, snoozed: false };
    const listeners = new Set<() => void>();
    let wake: ReturnType<typeof setTimeout> | null = null;

    function emit(next: SnoozeState): void {
        state = next;
        for (const listener of listeners) listener();
    }

    // The banner has to come back by itself when the snooze runs out, with the
    // app open on the day and nothing else re-rendering it.
    function snoozeUntil(until: number | null): void {
        if (wake !== null) clearTimeout(wake);
        wake = null;
        const left = until === null ? 0 : until - now();
        emit({ hydrated: true, snoozed: left > 0 });
        if (left > 0) wake = setTimeout(() => snoozeUntil(null), left);
    }

    let chosen = false;

    async function hydrate(): Promise<void> {
        const stored = await AsyncStorage.getItem(key).catch(() => null);
        if (chosen) return;
        snoozeUntil(parse(stored));
    }

    return {
        subscribe: hydratingSubscribe(listeners, hydrate),
        getSnapshot: (): SnoozeState => state,
        snooze(): void {
            chosen = true;
            const until = now() + SNOOZE_MS;
            snoozeUntil(until);
            void AsyncStorage.setItem(key, String(until)).catch(() => undefined);
        },
    };
}

export type SnoozeStore = ReturnType<typeof createSnoozeStore>;

export const notificationsBannerSnooze = createSnoozeStore('lustre.notificationsBannerSnoozedUntil');

export function useSnooze(store: SnoozeStore): SnoozeState {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
