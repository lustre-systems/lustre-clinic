import type { AppointmentStatus } from '@lustre/shared';
import type { Appointment } from './data/types';

const SETTLED: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>(['done', 'cancelled', 'no_show']);

export function isSettled(appointment: Appointment): boolean {
    return SETTLED.has(appointment.status);
}

export function procedureLabel(appointment: Appointment): string | undefined {
    if (appointment.procedures.length === 0) return undefined;
    return appointment.procedures.map((row) => row.name).join(' · ');
}

export function rowSummary(appointment: Appointment): string | undefined {
    return appointment.note?.trim() || procedureLabel(appointment);
}

export interface DaySplit {
    past: Appointment[];
    upcoming: Appointment[];
}

export function splitDay(
    appointments: readonly Appointment[],
    activeId: string | null,
    fold = true,
): DaySplit {
    const byTime = [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const rest = activeId === null ? byTime : byTime.filter((row) => row.id !== activeId);

    if (!fold) return { past: [], upcoming: rest };

    return {
        past: rest.filter(isSettled),
        upcoming: rest.filter((row) => !isSettled(row)),
    };
}
