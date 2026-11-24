import type { ClinicDay } from './data/types';
import { clockToMinutes, weekdayOf } from './time';

export interface DayHours {
    opens: number;
    closes: number;
}

const DEFAULTS: Readonly<Record<number, DayHours | null>> = {
    0: { opens: 10 * 60, closes: 22 * 60 },
    1: { opens: 10 * 60, closes: 22 * 60 },
    2: { opens: 10 * 60, closes: 22 * 60 },
    3: { opens: 10 * 60, closes: 22 * 60 },
    4: { opens: 10 * 60, closes: 22 * 60 },
    5: null,
    6: { opens: 10 * 60, closes: 22 * 60 },
};

export function hoursFor(
    dateKey: string,
    schedule: readonly ClinicDay[] | undefined,
    branchId?: string | null,
): DayHours | null {
    const weekday = weekdayOf(dateKey);

    if (schedule !== undefined && schedule.length > 0) {
        const day = schedule.find(
            (row) => row.weekday === weekday && (!branchId || row.branchId === branchId),
        );
        return day ? { opens: clockToMinutes(day.opensAt), closes: clockToMinutes(day.closesAt) } : null;
    }

    return DEFAULTS[weekday] ?? null;
}

export function isClosed(
    dateKey: string,
    schedule: readonly ClinicDay[] | undefined,
    branchId?: string | null,
): boolean {
    return hoursFor(dateKey, schedule, branchId) === null;
}

export function openMinutes(
    dateKey: string,
    schedule: readonly ClinicDay[] | undefined,
    branchId?: string | null,
): number {
    const hours = hoursFor(dateKey, schedule, branchId);
    return hours ? hours.closes - hours.opens : 0;
}
