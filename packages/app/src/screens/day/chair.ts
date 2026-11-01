/**
 * Who is in the chair. `checked_in` means arrived, not seated — the desk checks
 * people in as they come and they queue, so the chair is whoever arrived first
 * (`checkedInAt`, falling back to `updatedAt` when the visit is not to hand)
 * and the rest wait. The chair leaves the queue the moment they go to
 * `awaiting_payment` or `done`, which makes the longest wait the new head. Both
 * screens read the queue from here so they cannot disagree about who is seated.
 *
 * The server promotes on the same rule and writes `visits.in_chair_at` as it
 * does, so the stamp and this ordering name the same patient. That is not a
 * coincidence to be relied on loosely — if either side changes how it picks,
 * the other has to change with it, or a bar will start counting for someone the
 * screen has not put in the chair.
 *
 * The two days differ only in what they count as over. The doctor is finished
 * when the patient goes out to pay, so `awaiting_payment` is settled for him;
 * the desk is not finished until the money is in, so it holds the black card.
 * `slotProgress` runs the booked duration from `in_chair_at` — when the patient
 * reached the chair, not when they arrived — and is left uncapped once that
 * runs over.
 */
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

/**
 * Where the patient stands. `finished` is the odd one out — they are not in the
 * clinic at all: the visit is closed, or has been reopened to be corrected,
 * which is a different thing from one that is still running.
 */
export type Standing = 'waiting' | 'chair' | 'desk' | 'finished';

/**
 * Where a patient stands when the queue is out of view — a visit opened from a
 * patient's record rather than from the day.
 *
 * The date has to be read with the status. `awaiting_payment` means standing at
 * the desk *today*; on a day gone by it means a visit that was sent to the desk
 * and never settled, and nobody is standing anywhere. Reading the status alone
 * put a patient from three weeks ago at the desk waiting to pay.
 */
export function standingFor(appointment: Appointment, today: string): Standing {
    if (appointment.status === 'done') return 'finished';
    // `dateKey`, not the ISO string's first ten characters: the day a late
    // appointment falls on is the local one, and the wire carries UTC.
    if (dateKey(appointment.startsAt) !== today) return 'finished';
    return appointment.status === 'awaiting_payment' ? 'desk' : 'chair';
}

/**
 * The arrival queue: everyone checked in, earliest arrival first. The head is
 * in the chair, the tail is the waiting room.
 */
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
    /** The black card. Money owed outranks the chair — the desk's job is to collect it. */
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
    /** The running count on its own — the only part that changes each second. */
    count: string;
    /** What it is counted against: "/ 30 min" while inside the slot, "over" past it. */
    of: string;
    /** Both halves, for the one-line form the doctor's strip draws. */
    label: string;
    window: string;
}

/**
 * How far into the visit the clock is.
 *
 * The bar runs the booked duration from `seatedAt` — `visits.in_chair_at`, the
 * moment the patient reached the chair. A 30-minute appointment is 30 minutes
 * of bar, and it starts when the visit does.
 *
 * Three rules have now been tried here and the history is worth keeping. The
 * first ran from `checked_in_at` *and* set the denominator to
 * `bookedEnd - checkedInAt`; that subtraction drew `0 / 223 min` for a noon
 * consultation checked in at 08:47. The second fixed the denominator but moved
 * the start to the booked slot, which left a patient the card called IN THE
 * CHAIR sitting at zero for hours. The third put the start back on
 * `checked_in_at`, which is right for whoever walks into an empty chair and
 * wrong for everyone behind them: the second patient of the morning was charged
 * with the first one's visit, and read `11:40 over` before being seen.
 *
 * All three failed for one reason — arriving and being seated are different
 * events and only one of them was recorded. `in_chair_at` is that second
 * event, stamped by the server when the chair empties, so this function no
 * longer has to guess.
 *
 * `seatedAt` missing means nobody is in the chair yet, and the fallback is the
 * booked start. The caller decides what to fall back through: the screens pass
 * `inChairAt ?? checkedInAt` so that a visit recorded before this column
 * existed still draws something sensible.
 *
 * `nowMinutes` may carry a fraction. The chair feeds it a per-second clock so
 * the label can tick and the bar can move between whole minutes; everything
 * else passes whole minutes and gets `:00` on the seconds, which is honest —
 * that is all a thirty-second tick knows.
 *
 * All of the arithmetic is in whole seconds, and that is load-bearing rather
 * than tidiness. Minutes carrying a fraction of a second cannot be converted
 * back by multiplying: `(587 + 23/60 - 560) * 60` is 1642.9999999999995 in
 * binary, and the floor of that is a second that never gets displayed. Counting
 * up from a seating stamp it dropped 160 seconds out of every 600 — the skips
 * were the float, not the timer. `Math.round` at the one point the fraction
 * becomes a count is what fixes it; every value downstream is an integer.
 */
export function slotProgress(appointment: Appointment, nowMinutes: number, seatedAt?: string): SlotProgress {
    const booked = minutesOfDay(appointment.startsAt);
    const duration = appointment.durationMinutes;
    const ends = booked + duration;

    const fromSeconds = seatedAt ? secondsOfDay(seatedAt) : booked * 60;
    const elapsed = Math.max(Math.round(nowMinutes * 60) - fromSeconds, 0);
    const total = duration * 60;
    const over = elapsed - total;

    // English in both languages, `'en'` said rather than left to the default.
    // The readout is one Latin run — a mono count, a slash, and what it is
    // counted against — and `ChairProgress` draws it left to right in Arabic
    // too. A localized `دقيقة` on the end of that is a word running the other
    // way inside a figure that cannot, which is the half of this the reader
    // notices after the digits stop reading backwards.
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
