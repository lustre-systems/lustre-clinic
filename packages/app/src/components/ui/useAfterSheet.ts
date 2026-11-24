import { useCallback, useRef } from 'react';

export type AfterSheet = {
    after: (run: () => void) => void;
    closed: () => void;
};

export function useAfterSheet(): AfterSheet {
    const pending = useRef<(() => void) | null>(null);

    const after = useCallback((run: () => void) => {
        pending.current = run;
    }, []);

    const closed = useCallback(() => {
        const run = pending.current;
        pending.current = null;
        run?.();
    }, []);

    return { after, closed };
}
