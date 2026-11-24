export function hydratingSubscribe(
    listeners: Set<() => void>,
    hydrate: () => Promise<void>,
): (listener: () => void) => () => void {
    let hydrating = false;

    return (listener) => {
        listeners.add(listener);
        if (!hydrating) {
            hydrating = true;
            void hydrate();
        }
        return () => {
            listeners.delete(listener);
        };
    };
}
