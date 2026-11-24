import { useMemo, useRef, useState } from 'react';
import { noteScreen } from '../reporting/trail';
import { useBackHandler } from '../shell/useBackHandler';
import {
    canPop,
    clear,
    emptyStack,
    pop,
    popToRoot,
    push,
    type RouteStack,
    replaceTop,
    resetTo,
    settled,
    top,
} from './routeStack';

export type RouteStackOptions<T> = {
    locked?: boolean;
    atRoot?: () => boolean;
    backFrom?: (route: T) => boolean;
};

export type RouteStackControls<T> = {
    stack: RouteStack<T>;
    current: T | undefined;
    push(route: T): void;
    back(): void;
    pop(): void;
    popToRoot(): void;
    clear(): void;
    replaceTop(route: T): void;
    resetTo(route: T): void;
    settled(): void;
};

export function useRouteStack<T>(options: RouteStackOptions<T> = {}): RouteStackControls<T> {
    const [stack, setStack] = useState<RouteStack<T>>(emptyStack<T>);
    const { locked = false, atRoot, backFrom } = options;

    const latest = useRef({ stack, backFrom });
    latest.current = { stack, backFrom };

    const controls = useMemo(
        () => ({
            push: (route: T) => {
                noteScreen(route);
                setStack((current) => push(current, route));
            },
            back: () => {
                noteScreen('back');
                const current = top(latest.current.stack);
                if (current !== undefined && latest.current.backFrom?.(current)) return;
                setStack(pop);
            },
            pop: () => {
                noteScreen('back');
                setStack(pop);
            },
            popToRoot: () => {
                noteScreen('home');
                setStack(popToRoot);
            },
            clear: () => setStack(clear),
            replaceTop: (route: T) => {
                noteScreen(route);
                setStack((current) => replaceTop(current, route));
            },
            resetTo: (route: T) => {
                noteScreen(route);
                setStack((current) => resetTo(current, route));
            },
            settled: () => setStack(settled),
        }),
        [],
    );

    useBackHandler(() => {
        if (locked) return true;
        if (!canPop(stack)) return atRoot?.() ?? false;
        controls.back();
        return true;
    });

    return { stack, current: top(stack), ...controls };
}
