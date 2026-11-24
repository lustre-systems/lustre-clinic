import { DAY_FILLING_STATUSES, DEFAULT_DURATION_MINUTES, SLOT_HOLDING_STATUSES } from '@lustre/shared';
import type { Appointment, ClinicDay } from './data/types';
import { openMinutes } from './hours';

export interface DayLoad {
    count: number;
    used: number;
    slots: number;
    fill: number;
    firstAt: string | null;
    busiest: string | null;
}

export function holdsSlot(appointment: Appointment): boolean {
    return (SLOT_HOLDING_STATUSES as readonly string[]).includes(appointment.status);
}

function filledSlot(appointment: Appointment): boolean {
    return (DAY_FILLING_STATUSES as readonly string[]).includes(appointment.status);
}

export function busiestBranch(rows: readonly Appointment[], current: string | null): string | null {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.branchId, (counts.get(row.branchId) ?? 0) + 1);

    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
        if (count > bestCount || (count === bestCount && id === current)) {
            best = id;
            bestCount = count;
        }
    }

    return best;
}

export function loadsFrom(
    days: readonly string[],
    perDay: readonly Appointment[][],
    schedule: readonly ClinicDay[] | undefined,
    current: string | null,
): Map<string, DayLoad> {
    const loads = new Map<string, DayLoad>();

    days.forEach((day, index) => {
        const holding = (perDay[index] ?? []).filter(filledSlot);
        const booked = holding.reduce((total, row) => total + row.durationMinutes, 0);
        const open = openMinutes(day, schedule);
        const slots = Math.floor(open / DEFAULT_DURATION_MINUTES);
        const firstAt = holding.map((row) => row.startsAt).sort((a, b) => a.localeCompare(b))[0];

        loads.set(day, {
            count: holding.length,
            used: Math.min(Math.ceil(booked / DEFAULT_DURATION_MINUTES), slots),
            slots,
            fill: open > 0 ? Math.min(booked / open, 1) : 0,
            firstAt: firstAt ?? null,
            busiest: busiestBranch(holding, current),
        });
    });

    return loads;
}
