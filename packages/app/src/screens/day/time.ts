/**
 * Dates as the clinic sees them. The server takes a `YYYY-MM-DD` and an
 * `offsetMinutes` and works out the day boundary itself, so the client's whole
 * job is to say which clinic day it means and where in that day a time falls.
 * All of it is the clinic's time (`clinicTime` in `@lustre/shared`), never the
 * phone's zone, and keys are reckoned in UTC. The offset the server wants is
 * the one that starts the date in question (`offsetForDate`): Egypt keeps DST,
 * and today's offset applied to a day on the other side of the changeover
 * moves the range by an hour. `dateKey` must never be `toISOString`, which is
 * UTC. Weekdays are 0 = Sunday … 6 = Saturday, matching `clinic_days.weekday`.
 * The header pill adds the weekday off today, because a bare date does not say
 * whether Thursday is the day she meant.
 *
 * Clock times are not formatted here. They come from `domain/clock`, the one
 * place in the app that turns a time into text, and are re-exported so this
 * stays the day cluster's single time import. That file is reached directly
 * rather than through the `domain` barrel because the barrel pulls in
 * `react-native`, and this module and `chair.ts` are both imported by
 * `day.test.ts`, which runs under Bun with no Metro.
 *
 * What is left here is transport, not display: `clockToMinutes` reads the
 * 24-hour `HH:MM` the server sends, and nothing in this cluster writes one back
 * — the schedule is edited in settings, which has its own `timeFromMinutes`.
 */
import {
    addDays,
    addMonths,
    clinicOffsetNow,
    dateKey,
    isoAt,
    keyParts,
    localizeCopy,
    monthDays,
    offsetForDate,
    weekdayOf,
} from '@lustre/shared';
// Past the `api` barrel for the same reason as `domain/clock` below.
import { serverToday } from '../../api/serverClock';
import { getLocale } from '../../i18n/runtime';

export {
    clock12,
    formatClock12,
    formatDuration,
    formatElapsed,
    formatSpan,
    formatTime12,
    minutesOfDay,
    secondsOfDay,
    time12,
} from '../../components/domain/clock';

export {
    addDays,
    addMonths,
    clinicOffsetNow,
    dateKey,
    isoAt,
    keyParts,
    monthDays,
    offsetForDate,
    serverToday as todayKey,
    weekdayOf,
};

export function clockToMinutes(clock: string): number {
    const [hours = 0, minutes = 0] = clock.split(':').map(Number);
    return hours * 60 + minutes;
}

/** The day of the month, for a date tile. */
export function dayOfMonth(key: string): number {
    return keyParts(key).day;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;
const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

export function weekdayName(weekday: number): string {
    return WEEKDAYS[weekday] ?? '';
}

/** Weekday and month names are copy, and the date helpers below are called
 * from plain functions rather than rendered, so they localize themselves. */
function say(copy: string): string {
    return localizeCopy(getLocale(), copy);
}

/**
 * "Thursday, 12 June 2026" — the visit screens' identity line. Spelled out in
 * full because those screens are the record of what happened on a day, and
 * `Thu 12 Jun` is the form for a list being scanned, not for a line being read.
 */
export function formatLongDate(key: string): string {
    const date = keyParts(key);
    return `${say(WEEKDAYS[date.weekday] ?? '')}, ${date.day} ${say(MONTHS[date.month - 1] ?? '')} ${date.year}`;
}

export function formatDate(key: string): string {
    const date = keyParts(key);
    return `${say(WEEKDAYS_SHORT[date.weekday] ?? '')} ${date.day} ${say(MONTHS_SHORT[date.month - 1] ?? '')}`;
}

export function formatDatePill(key: string, today: string = serverToday()): string {
    const date = keyParts(key);
    const month = MONTHS_SHORT[date.month - 1] ?? '';
    const stamp = `${date.day} ${getLocale() === 'ar' ? say(month) : month.toUpperCase()}`;
    if (key === today) return stamp;
    const weekday = WEEKDAYS_SHORT[date.weekday] ?? '';
    return `${getLocale() === 'ar' ? say(weekday) : weekday.toUpperCase()} ${stamp}`;
}

/** The month a date tile shows under its number. */
export function monthShort(key: string): string {
    return say(MONTHS_SHORT[keyParts(key).month - 1] ?? '');
}

export function formatMonth(key: string): string {
    const date = keyParts(key);
    return `${say(MONTHS_SHORT[date.month - 1] ?? '')} ${date.year}`;
}

export function relativeDayLabel(key: string, today: string = serverToday()): string {
    if (key === today) return say('Today');
    if (key === addDays(today, 1)) return say('Tomorrow');
    if (key === addDays(today, -1)) return say('Yesterday');
    return formatDate(key);
}
