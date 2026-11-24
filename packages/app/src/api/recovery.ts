import { getConnectionState, subscribeToConnection } from './connection';
import { queryClient } from './queryClient';

export function startConnectionRecovery(): () => void {
    let previous = getConnectionState().status;

    return subscribeToConnection(() => {
        const { status } = getConnectionState();
        const recovered = status === 'online' && previous !== 'online';
        previous = status;

        if (!recovered) return;

        void queryClient.refetchQueries({
            type: 'active',
            predicate: (query) => query.state.status === 'error',
        });

        queryClient.resetQueries({
            type: 'inactive',
            predicate: (query) => query.state.status === 'error',
        });
    });
}
