// biome-ignore lint/style/noRestrictedImports: registers with the pane's back stack, which the shell's `BackHandler` listener reads from outside this tree
import { createContext, useContext, useEffect, useRef } from 'react';
import type { BackHandler, BackStack } from './backStack';

export const BackStackContext = createContext<BackStack | null>(null);

export function useBackHandler(handler: BackHandler): void {
    const stack = useContext(BackStackContext);
    const latest = useRef(handler);
    latest.current = handler;

    useEffect(() => {
        if (!stack) return;
        return stack.push(() => latest.current());
    }, [stack]);
}
