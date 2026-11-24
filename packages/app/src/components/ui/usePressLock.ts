import { useCallback, useRef } from 'react';

export function usePressLock(lockMs: number): (press: () => void) => void {
    const lockedUntil = useRef(0);

    return useCallback(
        (press: () => void) => {
            const now = Date.now();
            if (now < lockedUntil.current) return;
            lockedUntil.current = now + lockMs;
            press();
        },
        [lockMs],
    );
}
