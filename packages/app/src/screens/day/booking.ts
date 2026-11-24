import type { Appointment, ClinicDay } from './data/types';
import { hoursFor, isClosed } from './hours';
import { holdsSlot } from './month';
import { addDays, clock12, formatDate, minutesOfDay, relativeDayLabel } from './time';

export const MIN_SLOT_STEP = 5;

export type SlotState = 'free' | 'taken' | 'past';

export interface Slot {
    minutes: number;
    state: SlotState;
    runsLate: boolean;
}

export interface SlotsInput {
    dateKey: string;
    schedule: readonly ClinicDay[] | undefined;
    appointments: readonly Appointment[];
    branchId: string | null;
    durationMinutes: number;
    nowMinutes: number | null;
}

export function slotsFor({
    dateKey,
    schedule,
    appointments,
    branchId,
    durationMinutes,
    nowMinutes,
}: SlotsInput): Slot[] {
    const hours = hoursFor(dateKey, schedule, branchId);
    if (!hours) return [];

    const busy = appointments.filter(holdsSlot).map((row) => {
        const start = minutesOfDay(row.startsAt);
        return { start, end: start + row.durationMinutes };
    });

    const step = Math.max(durationMinutes, MIN_SLOT_STEP);

    const starts: number[] = [];
    for (let minutes = hours.opens; minutes < hours.closes; minutes += step) {
        starts.push(minutes);
    }

    return starts.map((minutes) => {
        const end = minutes + durationMinutes;
        const taken = busy.some((row) => minutes < row.end && row.start < end);
        const past = nowMinutes !== null && minutes < nowMinutes;

        return {
            minutes,
            state: taken ? 'taken' : past ? 'past' : 'free',
            runsLate: end > hours.closes,
        };
    });
}

export function firstFreeSlot(slots: readonly Slot[]): number | null {
    return slots.find((slot) => slot.state === 'free')?.minutes ?? null;
}

export function slotIsFree(slots: readonly Slot[], minutes: number | null): boolean {
    if (minutes === null) return false;
    return slots.some((slot) => slot.minutes === minutes && slot.state === 'free');
}

export function workingDaysIn(
    today: string,
    days: number,
    schedule: readonly ClinicDay[] | undefined,
    branchId: string | null,
): string[] {
    return Array.from({ length: days }, (_, index) => addDays(today, index)).filter(
        (key) => !isClosed(key, schedule, branchId),
    );
}

export function daysOffered(
    today: string,
    windowDays: number,
    farDay: string | null,
    schedule: readonly ClinicDay[] | undefined,
    branchId: string | null,
): string[] {
    const window = workingDaysIn(today, windowDays, schedule, branchId);
    if (!farDay || farDay < today || window.includes(farDay)) return window;
    if (isClosed(farDay, schedule, branchId)) return window;
    return [...window, farDay].sort();
}

export interface SettleInput {
    date: string;
    farDay: string | null;
    workingDays: readonly string[];
    openDays: readonly string[];
}

export function settleBookingDay({ date, farDay, workingDays, openDays }: SettleInput): {
    date: string;
    strip: string[];
} {
    if (openDays.includes(date)) return { date, strip: [...openDays] };
    if (date === farDay && workingDays.includes(date)) return { date, strip: [...openDays, date].sort() };
    if (openDays.length > 0) return { date: openDays[0] as string, strip: [...openDays] };
    return { date, strip: [...openDays] };
}

export function withoutAppointment(
    fetched: readonly (readonly Appointment[])[] | undefined,
    id: string | undefined,
): readonly (readonly Appointment[])[] | undefined {
    if (!fetched || !id) return fetched;
    return fetched.map((day) => day.filter((row) => row.id !== id));
}

export interface Fortnight {
    slotsByDay: Map<string, Slot[]>;
    openDays: string[];
}

export interface FortnightInput {
    days: readonly string[];
    fetched: readonly (readonly Appointment[])[] | undefined;
    schedule: readonly ClinicDay[] | undefined;
    branchId: string | null;
    durationMinutes: number;
    today: string;
    nowMinutes: number;
}

export function fortnightSlots({
    days,
    fetched,
    schedule,
    branchId,
    durationMinutes,
    today,
    nowMinutes,
}: FortnightInput): Fortnight {
    const slotsByDay = new Map<string, Slot[]>();
    if (!fetched) return { slotsByDay, openDays: [] };

    days.forEach((key, index) => {
        slotsByDay.set(
            key,
            slotsFor({
                dateKey: key,
                schedule,
                appointments: (fetched[index] ?? []).filter((row) => row.branchId === branchId),
                branchId,
                durationMinutes,
                nowMinutes: key === today ? nowMinutes : null,
            }),
        );
    });

    return {
        slotsByDay,
        openDays: days.filter((key) => (slotsByDay.get(key) ?? []).some((slot) => slot.state === 'free')),
    };
}

export function dayLabel(key: string): string {
    const label = relativeDayLabel(key);
    return label === formatDate(key) ? label : label.toLowerCase();
}

export function timeLabel(minutes: number): string {
    const { time, meridiem } = clock12(minutes);
    return `${time} ${meridiem}`;
}
