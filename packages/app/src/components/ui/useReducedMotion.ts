// biome-ignore lint/style/noRestrictedImports: subscribes to `AccessibilityInfo.reduceMotionChanged`, an OS setting that changes while the app is open
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        let alive = true;
        AccessibilityInfo.isReduceMotionEnabled().then((value) => {
            if (alive) setReduced(value);
        });
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
        return () => {
            alive = false;
            sub.remove();
        };
    }, []);

    return reduced;
}
