import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { hydratingSubscribe } from '../../shell/hydratingSubscribe';
import type { SavedSchedule } from './savedSchedule';

const KEY = 'lustre.savedSchedule';

export function createSavedScheduleStore() {
    let raw: string | null = null;
    const listeners = new Set<() => void>();
    let written = false;

    function emit(next: string | null): void {
        raw = next;
        for (const listener of listeners) listener();
    }

    async function hydrate(): Promise<void> {
        const stored = await AsyncStorage.getItem(KEY).catch(() => null);
        if (written) return;
        emit(stored);
    }

    return {
        subscribe: hydratingSubscribe(listeners, hydrate),
        getSnapshot: (): string | null => raw,
        async save(schedule: SavedSchedule): Promise<void> {
            const next = JSON.stringify(schedule);
            written = true;
            emit(next);
            await AsyncStorage.setItem(KEY, next).catch(() => undefined);
        },
    };
}

const store = createSavedScheduleStore();

export function useStoredSchedule(): string | null {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function saveSchedule(schedule: SavedSchedule): Promise<void> {
    return store.save(schedule);
}
