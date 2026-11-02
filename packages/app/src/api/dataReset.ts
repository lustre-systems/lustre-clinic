/**
 * The one signal that says everything read so far came from a database that is
 * no longer there.
 *
 * Demo mode swaps the transport underneath a shared cache. The query keys name
 * the procedure and its input, never which server answered, and `queryClient`
 * holds a day of them (`queryClient.ts`) — so a demo entered on a phone that
 * has been reading the real clinic paints real patients until each demo
 * request lands, and leaving the demo paints invented ones. Neither is a thing
 * to show a secretary, and the reseed behind "Reset demo data" has the same
 * shape: the rows the screens are holding no longer exist.
 *
 * This module imports nothing. It sits below `queryClient`, which reaches
 * `connection` and so back to `demo/flag`, and a cycle through that chain is
 * what the indirection is here to avoid — `client.ts` does the clearing,
 * `demo/flag.ts` and `demo/index.ts` only report the moment.
 *
 * `screens/day` runs a query layer of its own (`data/hooks.ts`) that the cache
 * knows nothing about, which is why this is a generation others can subscribe
 * to rather than a call to `queryClient.clear()` on its own.
 */

let generation = 0;
const listeners = new Set<() => void>();

/** Changes exactly when what has been read stops being worth keeping. */
export function dataGeneration(): number {
    return generation;
}

export function subscribeToDataReset(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

let clinic = 0;

/**
 * Changes when the clinic itself was swapped for another. The shell remounts on
 * this: clearing the cache does not close a page already open on a patient the
 * new clinic does not have. Apart from the generation above, which also moves
 * for a new role code, where nobody should lose their place.
 */
export function clinicGeneration(): number {
    return clinic;
}

export function noteClinicReplaced(): void {
    clinic += 1;
    noteDataReset();
}

export function noteDataReset(): void {
    generation += 1;
    for (const listener of listeners) listener();
}
