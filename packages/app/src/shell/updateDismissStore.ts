import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { hydratingSubscribe } from './hydratingSubscribe';

const DISMISSED_KEY = 'lustre.apkUpdateDismissed';

export interface DismissState {
    hydrated: boolean;
    versionCode: number | null;
}

function parse(stored: string | null): number | null {
    const code = stored === null ? Number.NaN : Number(stored);
    return Number.isSafeInteger(code) && code > 0 ? code : null;
}

export function createDismissStore() {
    let state: DismissState = { hydrated: false, versionCode: null };
    const listeners = new Set<() => void>();

    function emit(next: DismissState): void {
        state = next;
        for (const listener of listeners) listener();
    }

    let chosen = false;

    async function hydrate(): Promise<void> {
        const stored = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
        if (chosen) return;
        emit({ hydrated: true, versionCode: parse(stored) });
    }

    return {
        subscribe: hydratingSubscribe(listeners, hydrate),
        getSnapshot: (): DismissState => state,
        dismiss(versionCode: number): void {
            chosen = true;
            emit({ hydrated: true, versionCode });
            void AsyncStorage.setItem(DISMISSED_KEY, String(versionCode)).catch(() => undefined);
        },
    };
}

const store = createDismissStore();

export function useDismissedApkUpdate(): DismissState {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function dismissApkUpdate(versionCode: number): void {
    store.dismiss(versionCode);
}
