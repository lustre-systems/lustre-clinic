// biome-ignore lint/style/noRestrictedImports: the `AppState` subscription that checks when the phone comes back to the front
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { backUpIfDue } from '../api';

/**
 * The daily backup when the app is open, since Android may hold the background
 * task back for days on a phone it is saving battery on. A failure says nothing
 * here: the Backups row reports how old the last one is.
 */
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
