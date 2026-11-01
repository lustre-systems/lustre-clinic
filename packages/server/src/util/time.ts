/**
 * Time helpers. Every timestamp in the database is `timestamptz` (SPEC §5), so
 * these deal in absolute instants; a calendar day is only ever a day *for
 * somebody*, which is why the day-range helper takes the offset explicitly
 * rather than reading the server's own timezone. A caller on clinic time gets
 * the clinic's days, DST included (`clinicTime`).
 */
import { callerWallClock, pad2 } from '@lustre/shared';

export function ageFromBirthDate(birthDate: string | null, on: Date = new Date()): number | null {
    if (!birthDate) return null;

    const born = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return null;

    let age = on.getUTCFullYear() - born.getUTCFullYear();
    const monthDiff = on.getUTCMonth() - born.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < born.getUTCDate())) {
        age -= 1;
    }
    return age < 0 ? null : age;
}

export { clinicDayOf, dayRange } from '@lustre/shared';

/** `DDMMYY` of the day `at` falls on, for a caller who sent `offsetMinutes` as its offset now. */
export function refDatePart(at: Date, offsetMinutes = 0): string {
    const { year, month, day } = callerWallClock(at, offsetMinutes);
    return `${pad2(day)}${pad2(month)}${pad2(year % 100)}`;
}
