// biome-ignore lint/style/noRestrictedImports: the outside thing is the write itself — a slow answer must not set state on a control that has left the screen
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PendingAction<Args extends unknown[]> {
    run: (...args: Args) => void;
    pending: boolean;
}

export function usePendingAction<Args extends unknown[]>(
    action: (...args: Args) => Promise<unknown>,
): PendingAction<Args> {
    const [pending, setPending] = useState(false);

    const actionRef = useRef(action);
    actionRef.current = action;

    const inFlight = useRef(false);

    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const run = useCallback((...args: Args) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);

        void (async () => {
            try {
                await actionRef.current(...args);
            } catch {
            } finally {
                inFlight.current = false;
                if (mounted.current) setPending(false);
            }
        })();
    }, []);

    return { run, pending };
}
