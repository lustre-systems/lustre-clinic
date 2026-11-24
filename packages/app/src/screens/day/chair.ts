import type { AppointmentStatus } from '@lustre/shared';
import type { Appointment } from './data/types';
import { dateKey, formatDuration, formatElapsed, formatSpan, minutesOfDay, secondsOfDay } from './time';

const SETTLED: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
    'done',
    'cancelled',
    'no_show',
    'awaiting_payment',
]);

export interface Queue {
    chair: Appointment | null;
    waiting: Appointment[];
}

export type Standing = 'waiting' | 'chair' | 'desk' | 'finished';

export function standingFor(appointment: Appointment, today: string): Standing {
    if (appointment.status === 'done') return 'finished';
    if (dateKey(appointment.startsAt) !== today) return 'finished';
    return appointment.status === 'awaiting_payment' ? 'desk' : 'chair';
}

export function arrivalQueue(
    appointments: readonly Appointment[],
    checkedInAt: ReadonlyMap<string, string> = new Map(),
): Queue {
    const arrivedAt = (row: Appointment) => checkedInAt.get(row.id) ?? row.updatedAt;

    const queue = appointments
        .filter((row) => row.status === 'checked_in')
        .sort((a, b) => arrivedAt(a).localeCompare(arrivedAt(b)));

    return { chair: queue[0] ?? null, waiting: queue.slice(1) };
}

export interface DeskDay extends Queue {
    card: Appointment | null;
    desk: Appointment | null;
    next: Appointment | null;
}

export function splitDeskDay(
    appointments: readonly Appointment[],
    checkedInAt: ReadonlyMap<string, string> = new Map(),
): DeskDay {
    const { chair, waiting } = arrivalQueue(appointments, checkedInAt);

    const desk =
        appointments
            .filter((row) => row.status === 'awaiting_payment')
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0] ?? null;

    const next =
        appointments
            .filter((row) => row.status === 'booked')
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

    return { chair, waiting, desk, next, card: desk ?? chair ?? next };
}

export interface DoctorDay {
    chair: Appointment | null;
    waiting: Appointment[];
    headline: Appointment | null;
    strip: Appointment | null;
    list: Appointment[];
    past: Appointment[];
}

export function splitDoctorDay(
    appointments: readonly Appointment[],
    checkedInAt: ReadonlyMap<string, string> = new Map(),
): DoctorDay {
    const { chair, waiting } = arrivalQueue(appointments, checkedInAt);

    const booked = appointments
        .filter((row) => row.status === 'booked')
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const headline = waiting[0] ?? booked[0] ?? chair;
    const strip = chair && chair !== headline ? chair : null;
    const drawn = new Set([headline?.id, strip?.id]);

    return {
        chair,
        waiting,
        headline,
        strip,
        list: [...waiting, ...booked].filter((row) => !drawn.has(row.id)),
        past: appointments
            .filter((row) => SETTLED.has(row.status))
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    };
}

export interface SlotProgress {
    value: number;
    over: boolean;
    count: string;
    of: string;
    label: string;
    window: string;
}

export function slotProgress(appointment: Appointment, nowMinutes: number, seatedAt?: string): SlotProgress {
    const booked = minutesOfDay(appointment.startsAt);
    const duration = appointment.durationMinutes;
    const ends = booked + duration;

    const fromSeconds = seatedAt ? secondsOfDay(seatedAt) : booked * 60;
    const elapsed = Math.max(Math.round(nowMinutes * 60) - fromSeconds, 0);
    const total = duration * 60;
    const over = elapsed - total;

    const count = formatElapsed(over > 0 ? over : elapsed);
    const of = over > 0 ? 'over' : `/ ${formatDuration(duration, 'en')}`;

    return {
        value: total > 0 ? elapsed / total : 0,
        over: over > 0,
        count,
        of,
        label: `${count} ${of}`,
        window: formatSpan(booked, ends),
    };
}
