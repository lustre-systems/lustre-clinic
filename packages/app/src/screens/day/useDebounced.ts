// biome-ignore lint/style/noRestrictedImports: the lag is a `setTimeout` restarted on every change, and the cleanup cancelling the last one is what makes it a debounce rather than a queue
import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delayMs: number): T {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return settled;
}
