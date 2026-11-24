// biome-ignore lint/style/noRestrictedImports: subscribes to `BackHandler`, an OS event delivered outside React
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

export function useHardwareBack(enabled: boolean, onBack: () => boolean): void {
    const latest = useRef(onBack);
    latest.current = onBack;

    useEffect(() => {
        if (!enabled) return;

        const guard = BackHandler.addEventListener('hardwareBackPress', () => latest.current());
        return () => guard.remove();
    }, [enabled]);
}
