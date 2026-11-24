import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { hydratingSubscribe } from '../shell/hydratingSubscribe';

const ALARM_KEY = 'lustre.reminderAlarm';

export interface AlarmState {
    hydrated: boolean;
    enabled: boolean;
}

export function createAlarmStore() {
    let state: AlarmState = { hydrated: false, enabled: false };
    const listeners = new Set<() => void>();

    function emit(next: AlarmState): void {
        state = next;
        for (const listener of listeners) listener();
    }

    let chosen = false;
    let writes = 0;

    async function hydrate(): Promise<void> {
        const stored = await AsyncStorage.getItem(ALARM_KEY).catch(() => null);
        if (chosen) return;
        emit({ hydrated: true, enabled: stored === 'on' });
    }

    return {
        subscribe: hydratingSubscribe(listeners, hydrate),
        getSnapshot: (): AlarmState => state,
        set(enabled: boolean): void {
            chosen = true;
            const previous = state.enabled;
            const write = ++writes;
            emit({ hydrated: true, enabled });
            void AsyncStorage.setItem(ALARM_KEY, enabled ? 'on' : 'off').catch(() => {
                if (write === writes) emit({ hydrated: true, enabled: previous });
            });
        },
    };
}

const store = createAlarmStore();

export function useReminderAlarm(): AlarmState {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function setReminderAlarm(enabled: boolean): void {
    store.set(enabled);
}
