let generation = 0;
const listeners = new Set<() => void>();

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
