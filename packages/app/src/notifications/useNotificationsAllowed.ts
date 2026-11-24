// biome-ignore lint/style/noRestrictedImports: subscribes to `AppState` to re-read the OS permission on foreground — the fix happens in Android settings, outside the app
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { canTakeOverLockScreen } from '../../modules/lustre-alarm';
import { notificationsAllowed } from './notifications';

export type NotificationsAllowed = 'unknown' | 'allowed' | 'blocked';

export function useNotificationsAllowed(): NotificationsAllowed {
    return useReadOnForeground(async () => ((await notificationsAllowed()) ? 'allowed' : 'blocked'));
}

export function useLockScreenAllowed(): NotificationsAllowed {
    return useReadOnForeground(async () => (canTakeOverLockScreen() ? 'allowed' : 'blocked'));
}

function useReadOnForeground(read: () => Promise<NotificationsAllowed>): NotificationsAllowed {
    const [allowed, setAllowed] = useState<NotificationsAllowed>('unknown');

    // biome-ignore lint/correctness/useExhaustiveDependencies: `read` is a fresh closure each render and reads nothing from it
    useEffect(() => {
        let live = true;

        const update = () => {
            void read().then((next) => {
                if (live) setAllowed(next);
            });
        };

        update();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') update();
        });

        return () => {
            live = false;
            subscription.remove();
        };
    }, []);

    return allowed;
}
