/**
 * Calendar arithmetic on `YYYY-MM-DD` keys. All of it runs in UTC, where the
 * phone's zone cannot reach it: a key is a name for a day, not an instant.
 * Turning an instant into a clinic day or time is `clinicTime.ts`'s job.
 *
 * Calendar arithmetic only — no clock formatting. A time on screen is 12-hour
 * with a meridiem, the meridiem localizes to ص/م, and both of those are
 * presentation rather than a contract, so they live in the app at
 * `components/domain/clock.ts`.
 */

export const DAY_MINUTES = 24 * 60;

export function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

export interface KeyParts {
    year: number;
    /** 1–12. */
    month: number;
    day: number;
    /** 0 = Sunday … 6 = Saturday, as `clinic_days.weekday`. */
    weekday: number;
}

function utcOf(key: string): Date {
    const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function keyOf(date: Date): string {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function keyParts(key: string): KeyParts {
    const date = utcOf(key);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
    };
}

export function addDays(key: string, days: number): string {
    const date = utcOf(key);
    date.setUTCDate(date.getUTCDate() + days);
    return keyOf(date);
}

/** The first of the month `months` from `key`'s. */
export function addMonths(key: string, months: number): string {
    const date = utcOf(key);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    return keyOf(date);
}

export function weekdayOf(key: string): number {
    return keyParts(key).weekday;
}

/** Every day of `key`'s month, in order. */
export function monthDays(key: string): string[] {
    const { year, month } = keyParts(key);
    return Array.from(
        { length: daysInMonth(year, month) },
        (_, index) => `${year}-${pad2(month)}-${pad2(index + 1)}`,
    );
}

/** The Gregorian calendar, not a rule about any particular date. */
export function daysInMonth(year: number, month: number): number {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}
