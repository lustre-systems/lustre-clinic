import type { ConnectionStatus } from '../api';
import type { TabKey } from '../components/domain';

export type Ask<T> = T & { seq: number };

export function ask<T>(current: Ask<unknown> | undefined, next: T): Ask<T> {
    return { ...next, seq: (current?.seq ?? 0) + 1 };
}

export function isUnseen(request: Ask<unknown> | undefined, seen: number): boolean {
    return request !== undefined && request.seq !== seen;
}

export const ALL_TABS: readonly TabKey[] = ['day', 'patients', 'stats', 'settings'];

export type ShellRoute = 'app' | 'offline';

export function nextRoute(current: ShellRoute, status: ConnectionStatus): ShellRoute {
    if (status === 'offline') return 'offline';
    if (status === 'online') return 'app';
    return current;
}

export type HomeSignals = Record<TabKey, number>;

export const NO_HOME: HomeSignals = { day: 0, patients: 0, stats: 0, settings: 0 };

export function bumpHome(current: HomeSignals, tab: TabKey): HomeSignals {
    return { ...current, [tab]: current[tab] + 1 };
}

export type PatientTarget = {
    id: string;
    name: string;
    phone: string;
};

export type BookingTiming = 'now' | 'later';
