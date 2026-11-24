// biome-ignore lint/style/noRestrictedImports: subscribes to `AppState`, because Open reminders is tapped outside the app and lands as a foreground
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { takeOpenRequest } from '../../modules/lustre-alarm';

export function useAlarmOpen(onOpen: () => void, ready: boolean): void {
    useEffect(() => {
        if (!ready) return;
        const check = () => {
            if (takeOpenRequest()) onOpen();
        };

        check();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') check();
        });
        return () => subscription.remove();
    }, [onOpen, ready]);
}
