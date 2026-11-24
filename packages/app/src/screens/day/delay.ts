import { localizeCopy } from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';
import { isSettled } from './agenda';
import { MIN_SLOT_STEP } from './booking';
import { arrivalQueue } from './chair';
import type { Appointment } from './data/types';
import { formatDuration, minutesOfDay } from './time';

export interface DayDelay {
    minutes: number;
    fromChair: number;
}

export const ON_TIME: DayDelay = { minutes: 0, fromChair: 0 };

export function dayDelay(
    appointments: readonly Appointment[],
    nowMinutes: number | null,
    checkedInAt: ReadonlyMap<string, string> = new Map(),
): DayDelay {
    if (nowMinutes === null) return ON_TIME;

    const { chair } = arrivalQueue(appointments, checkedInAt);

    const fromChair = chair
        ? Math.max(0, nowMinutes - (minutesOfDay(chair.startsAt) + chair.durationMinutes))
        : 0;

    return { minutes: toSlot(fromChair), fromChair };
}

export function projectedStart(appointment: Appointment, delay: DayDelay, nowMinutes: number | null): number {
    const booked = minutesOfDay(appointment.startsAt);
    if (delay.minutes === 0 || isSettled(appointment)) return booked;

    const projected = booked + delay.minutes;
    return nowMinutes === null ? projected : Math.max(projected, toSlot(nowMinutes));
}

function toSlot(minutes: number): number {
    return Math.ceil(minutes / MIN_SLOT_STEP) * MIN_SLOT_STEP;
}

export function isProjected(appointment: Appointment, delay: DayDelay): boolean {
    return delay.minutes > 0 && !isSettled(appointment) && appointment.status === 'booked';
}

export function delayLabel(delay: DayDelay): string | null {
    return delay.fromChair > 0
        ? localizeCopy(getLocale(), '{duration} late', { duration: formatDuration(delay.fromChair) })
        : null;
}
