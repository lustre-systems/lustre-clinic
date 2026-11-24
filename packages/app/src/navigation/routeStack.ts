export type StackEntry<T> = {
    readonly id: number;
    readonly route: T;
};

export type RouteStack<T> = {
    readonly open: readonly StackEntry<T>[];
    readonly leaving: readonly StackEntry<T>[];
};

export function emptyStack<T>(): RouteStack<T> {
    return { open: [], leaving: [] };
}

function nextId<T>(stack: RouteStack<T>): number {
    let highest = -1;
    for (const entry of rendered(stack)) highest = Math.max(highest, entry.id);
    return highest + 1;
}

export function push<T>(stack: RouteStack<T>, route: T): RouteStack<T> {
    if (stack.open.length > 0 && sameRoute(top(stack), route)) return stack;
    return { open: [...stack.open, { id: nextId(stack), route }], leaving: [] };
}

function sameRoute(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(
        (key) =>
            Object.hasOwn(b, key) &&
            sameRoute((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
}

export function pop<T>(stack: RouteStack<T>): RouteStack<T> {
    if (stack.open.length === 0) return stack;
    return {
        open: stack.open.slice(0, -1),
        leaving: [...stack.open.slice(-1), ...stack.leaving],
    };
}

export function popToRoot<T>(stack: RouteStack<T>): RouteStack<T> {
    if (stack.open.length === 0) return stack;
    return { open: [], leaving: [...stack.open, ...stack.leaving] };
}

export function replaceTop<T>(stack: RouteStack<T>, route: T): RouteStack<T> {
    if (stack.open.length === 0) return push(stack, route);
    return {
        open: [...stack.open.slice(0, -1), { id: nextId(stack), route }],
        leaving: stack.leaving,
    };
}

export function resetTo<T>(stack: RouteStack<T>, route: T): RouteStack<T> {
    return { open: [{ id: nextId(stack), route }], leaving: [] };
}

export function clear<T>(stack: RouteStack<T>): RouteStack<T> {
    if (stack.open.length === 0 && stack.leaving.length === 0) return stack;
    return emptyStack<T>();
}

export function rendered<T>(stack: RouteStack<T>): readonly StackEntry<T>[] {
    return [...stack.open, ...stack.leaving];
}

export function isOpen<T>(stack: RouteStack<T>, index: number): boolean {
    return index < stack.open.length;
}

export function top<T>(stack: RouteStack<T>): T | undefined {
    return stack.open[stack.open.length - 1]?.route;
}

export function beneath<T>(stack: RouteStack<T>): T | undefined {
    return stack.open[stack.open.length - 2]?.route;
}

export function canPop<T>(stack: RouteStack<T>): boolean {
    return stack.open.length > 0;
}

export function isTop<T>(stack: RouteStack<T>, id: number): boolean {
    return stack.open[stack.open.length - 1]?.id === id;
}

export function settled<T>(stack: RouteStack<T>): RouteStack<T> {
    if (stack.leaving.length === 0) return stack;
    return { open: stack.open, leaving: stack.leaving.slice(0, -1) };
}
