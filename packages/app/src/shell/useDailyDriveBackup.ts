// biome-ignore lint/style/noRestrictedImports: the `AppState` subscription that checks when the phone comes back to the front
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { backUpIfDue } from '../api';

export function useDailyDriveBackup(local: boolean): void {
    useEffect(() => {
        if (!local) return;
        const check = () => void backUpIfDue().catch(() => undefined);
        check();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') check();
        });
        return () => subscription.remove();
    }, [local]);
}
