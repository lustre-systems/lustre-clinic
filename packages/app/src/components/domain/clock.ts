/**
 * The only place a clock time is turned into text. Every time in the app is
 * 12-hour with a meridiem — there is no 24-hour display anywhere — and this is
 * where that is decided, the way `MoneyValue` decides money.
 *
 * Kept free of `react-native` on purpose: `bun test` has no Metro, so anything
 * importing RN cannot be unit tested, and the day cluster's `time.ts` and
 * `chair.ts` are themselves imported by tests. The component that renders these
 * strings is `TimeValue`, which is where the RN import and the layout-direction
 * default live.
 *
 * Digits stay Latin in both languages (§7.11) — DM Mono has no Arabic-Indic
 * coverage and the tabular alignment the day view relies on would break. The
 * meridiem does localize: an Egyptian reader expects ص/م, not AM/PM. It comes
 * back as its own field rather than pre-joined because callers set it at a
 * different size, and because ص/م has to reach the Naskh face without dragging
 * the digits along with it.
 *
 * Every formatter follows the app's language unless told otherwise, so a
 * caller that forgets to pass one still gets ص/م in Arabic.
 *
 * Storage and transport are unchanged — `TIME` and `timestamptz` as before.
 * This is formatting only. The 24-hour `HH:MM` the server reads and writes is
 * still handled at the edges: `clockToMinutes` in the day cluster parses it in,
 * `timeFromMinutes` in `settings/data/reminders` writes it back out. Neither
 * string reaches a screen.
 */
import {
    minutesOfDay as clinicMinutesOfDay,
    secondsOfDay as clinicSecondsOfDay,
    type Locale,
    localizeCopy,
} from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';

export interface Clock12 {
    /** "6:00" — Latin digits, no leading zero on the hour. */
    time: string;
    /** "PM" in English, "م" in Arabic. */
    meridiem: string;
}

export const DAY_MINUTES = 24 * 60;

const MERIDIEM: Record<Locale, { am: string; pm: string }> = {
    en: { am: 'AM', pm: 'PM' },
    ar: { am: 'ص', pm: 'م' },
};

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

/** Minutes since the clinic's midnight (`clinicTime`), whatever zone the phone is on. */
export function minutesOfDay(at: string | number): number {
    return clinicMinutesOfDay(at);
}

/**
 * Seconds since midnight, for the one thing that counts in them.
 *
 * `minutesOfDay` truncates, which is right everywhere it is used to place a row
 * on a schedule and wrong for the chair's stopwatch: a patient seated at
 * 09:47:23 read as seated at 09:47:00, so the count ran up to 37 seconds ahead
 * of the visit it claimed to be measuring.
 */
export function secondsOfDay(at: string | number): number {
    return clinicSecondsOfDay(at);
}

export function clock12(minutes: number, locale: Locale = getLocale()): Clock12 {
    const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const hours = Math.floor(wrapped / 60);
    const marker = MERIDIEM[locale];

    return {
        time: `${hours % 12 === 0 ? 12 : hours % 12}:${pad(wrapped % 60)}`,
        meridiem: hours < 12 ? marker.am : marker.pm,
    };
}

export function time12(iso: string, locale: Locale = getLocale()): Clock12 {
    return clock12(minutesOfDay(iso), locale);
}

/** "6:00 PM" — the one-string form, for a label rather than a tabular column. */
export function formatClock12(minutes: number, locale: Locale = getLocale()): string {
    const { time, meridiem } = clock12(minutes, locale);
    return `${time} ${meridiem}`;
}

export function formatTime12(iso: string, locale: Locale = getLocale()): string {
    return formatClock12(minutesOfDay(iso), locale);
}

/** The same, off a wall-clock timestamp: the connection card's probe stamp. */
export function formatStamp(at: number, locale: Locale = getLocale()): string {
    return formatClock12(clinicMinutesOfDay(at), locale);
}

/**
 * "45 min", "1h 30m" — a length of time rather than a point on the clock.
 *
 * Nobody reads `223 min` as three and three-quarter hours. Three callers want
 * exactly this switch — the chair's progress bar, its overrun label, and the
 * day's delay headline — and each of them used to carry its own copy, which is
 * how the bar came to format hours on the overrun and not on the line above it.
 *
 * Two of those three want the app's language and get it from the default. The
 * chair's bar is the exception and passes `'en'`: its readout is a mono column
 * of Latin digits (§7.11) with this on the end of it, read the way a stopwatch
 * is read, and `45 دقيقة` puts a second script inside one figure — an Arabic
 * word that runs the other way, against digits that cannot. So the language is
 * a parameter rather than a decision made here.
 */
export function formatDuration(minutes: number, locale: Locale = getLocale()): string {
    if (minutes < 60) return localizeCopy(locale, '{minutes} min', { minutes });
    return localizeCopy(locale, '{hours}h {minutes}m', {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
    });
}

/**
 * "0:07", "12:34", "1:15:03" — a count that is running, in the shape every
 * stopwatch uses.
 *
 * This is deliberately not `formatDuration`. That one names a quantity someone
 * decided on — a slot is 45 minutes, a clinic is 1h 30m late — and rounding it
 * to the minute is right. This one is read to find out whether anything is
 * happening, so the seconds are the whole point: the chair's bar advances about
 * two percent a minute, which on a 5px track is invisible, and a label that sat
 * still for sixty seconds was why nobody believed the bar was moving.
 */
export function formatElapsed(totalSeconds: number): string {
    const whole = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(whole / 3_600);
    const minutes = Math.floor((whole % 3_600) / 60);
    const seconds = whole % 60;
    const pad = (value: number) => String(value).padStart(2, '0');

    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * "10:00 AM – 6:00 PM" — a span with the meridiem on both ends. Working hours
 * and the chair's window both read as a range, and dropping the opening
 * meridiem to save four characters makes 10–6 ambiguous in a clinic that could
 * plausibly do either.
 */
export function formatSpan(from: number, to: number, locale: Locale = getLocale()): string {
    return `${formatClock12(from, locale)} – ${formatClock12(to, locale)}`;
}
