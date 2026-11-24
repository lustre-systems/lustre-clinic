import { useCallback, useSyncExternalStore } from 'react';
import { type ConnectionState, getConnectionState, reprobe, subscribeToConnection } from './connection';

export interface Connection extends ConnectionState {
    isOnline: boolean;
    isOffline: boolean;
    retry: () => Promise<boolean>;
}

export function useConnection(): Connection {
    const state = useSyncExternalStore(subscribeToConnection, getConnectionState);
    const retry = useCallback(() => reprobe(), []);

    return {
        ...state,
        isOnline: state.status === 'online',
        isOffline: state.status === 'offline',
        retry,
    };
}
