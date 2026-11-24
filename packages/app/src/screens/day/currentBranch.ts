import { useSyncExternalStore } from 'react';
import type { ClinicDay } from './data/types';
import { todayKey, weekdayOf } from './time';

export interface BranchPick {
    day: string;
    branchId: string;
}

let pick: BranchPick | null = null;
const listeners = new Set<() => void>();

export function pickBranch(branchId: string): void {
    pick = { day: todayKey(), branchId };
    for (const listener of listeners) listener();
}

export function pickedOn(current: BranchPick | null, today: string): string | null {
    return current?.day === today ? current.branchId : null;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function usePickedBranch(): string | null {
    return useSyncExternalStore(subscribe, () => pickedOn(pick, todayKey()));
}

export function scheduledBranch(dateKey: string, schedule: readonly ClinicDay[] | undefined): string | null {
    const weekday = weekdayOf(dateKey);
    return schedule?.find((row) => row.weekday === weekday)?.branchId ?? null;
}
