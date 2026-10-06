/**
 * The clinic's wall clock. Every time on screen or typed in is the clinic's
 * (`CLINIC_TIME_ZONE`, Africa/Cairo), whatever zone or clock the phone is set
 * to, and this is the one place an instant and a clinic time of day are turned
 * into each other.
 *
 * It never asks the JS engine for a local time. The engine's zone is the
 * phone's, and a phone can carry zone data from before Egypt brought summer
 * time back in 2023: such a phone, wound forward an hour to look right, booked
 * a 5:30 as 6:30. Hermes reads the same stale data, so `Intl` with a `timeZone`
 * is no way out either. The offsets come from a table instead: the server's,
 * read off its current ICU and cached on the phone, or the one bundled at build
 * time (`clinicZone.bundled.ts`) until a server has sent one.
 *
 * "Now" is the server's clock where there is one: the app plugs its measured
 * skew in with `setClinicClock`. Everything else defaults to `Date.now`.
 *
 * Pure calendar arithmetic on `YYYY-MM-DD` keys lives in `dates.ts` and runs in
 * UTC, where no zone can reach it.
 */
import { BUNDLED_CLINIC_ZONE } from './clinicZone.bundled.ts';
import { addDays, keyParts, pad2 } from './dates.ts';

export interface ClinicZone {
    /** The IANA name, for logs and to tell two tables apart. */
    zone: string;
    /**
     * `[from, offset]`: from this instant (epoch ms) on, the clinic is `offset`
     * minutes east of UTC. Ascending. The first also holds before its start,
     * and the last after.
     */
    spans: [number, number][];
}

export interface ClinicWallClock {
    /** `YYYY-MM-DD`. */
    key: string;
    year: number;
    /** 1–12. */
    month: number;
    day: number;
    /** 0 = Sunday … 6 = Saturday, as `clinic_days.weekday`. */
    weekday: number;
    /** Minutes since the clinic's midnight. */
    minutes: number;
    /** Seconds since the clinic's midnight. */
    seconds: number;
}

type Instant = Date | number | string;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_OFFSET = 18 * 60;

let zone: ClinicZone = BUNDLED_CLINIC_ZONE;
let clock: () => number = Date.now;

export function setClinicZone(next: ClinicZone): void {
    zone = next;
}

export function clinicZone(): ClinicZone {
    return zone;
}

export function setClinicClock(next: () => number): void {
    clock = next;
}

/** The clinic's "now", in epoch ms: the server's clock when the app knows its skew. */
export function clinicNow(): number {
    return clock();
}

/** A table off the wire or out of storage, or null when it is not one. */
export function parseClinicZone(value: unknown): ClinicZone | null {
    if (typeof value !== 'object' || value === null) return null;
    const { zone: name, spans } = value as Partial<ClinicZone>;
    if (typeof name !== 'string' || !Array.isArray(spans) || spans.length === 0) return null;

    let last = Number.NEGATIVE_INFINITY;
    for (const span of spans) {
        if (!Array.isArray(span) || span.length !== 2) return null;
        const [from, offset] = span;
        if (!Number.isSafeInteger(from) || from <= last) return null;
        if (!Number.isInteger(offset) || Math.abs(offset) > MAX_OFFSET) return null;
        last = from;
    }
    return { zone: name, spans: spans.map(([from, offset]) => [from, offset]) };
}

function epoch(at: Instant): number {
    return typeof at === 'number' ? at : new Date(at).getTime();
}

/** Minutes east of UTC the clinic is at `at`. */
export function offsetAt(at: Instant): number {
    const time = epoch(at);
    const { spans } = zone;
    let low = 0;
    let high = spans.length - 1;
    // The last span starting at or before `time`; the first when none does.
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((spans[middle]?.[0] ?? 0) <= time) low = middle;
        else high = middle - 1;
    }
    return spans[low]?.[1] ?? 0;
}

/** `time` on a wall clock `offset` minutes east of UTC. */
function wallClockAt(time: number, offset: number): ClinicWallClock {
    const wall = new Date(time + offset * MINUTE);
    const minutes = wall.getUTCHours() * 60 + wall.getUTCMinutes();
    const year = wall.getUTCFullYear();
    const month = wall.getUTCMonth() + 1;
    const day = wall.getUTCDate();
    return {
        key: `${year}-${pad2(month)}-${pad2(day)}`,
        year,
        month,
        day,
        weekday: wall.getUTCDay(),
        minutes,
        seconds: minutes * 60 + wall.getUTCSeconds(),
    };
}

export function clinicWallClock(at: Instant): ClinicWallClock {
    const time = epoch(at);
    return wallClockAt(time, offsetAt(time));
}

/** The clinic's `YYYY-MM-DD` for an instant. Never `toISOString`, which is UTC. */
export function dateKey(at: Instant): string {
    return clinicWallClock(at).key;
}

export function minutesOfDay(at: Instant): number {
    return clinicWallClock(at).minutes;
}

export function secondsOfDay(at: Instant): number {
    return clinicWallClock(at).seconds;
}

export function todayKey(now: number = clinicNow()): string {
    return dateKey(now);
}

/**
 * The instant the clinic's clock reads `minutes` past midnight on `key`.
 *
 * A time the clock skips (the hour after midnight on the last Friday of April)
 * reads as the same time after the jump, the way a wall clock would; a time it
 * shows twice (the hour before midnight on the last Thursday of October) is the
 * first of the two.
 */
export function instantAt(key: string, minutes: number): number {
    const { year, month, day } = keyParts(key);
    const wall = Date.UTC(year, month - 1, day) + minutes * MINUTE;
    const before = offsetAt(wall - DAY);
    const after = offsetAt(wall + DAY);

    const fits = [before, after]
        .map((offset) => wall - offset * MINUTE)
        .filter((at, index) => offsetAt(at) === (index === 0 ? before : after));
    if (fits.length === 0) return wall - before * MINUTE;
    return Math.min(...fits);
}

/** `instantAt` as the ISO string the server takes, with the clinic's offset on it. */
export function isoAt(key: string, minutes: number): string {
    const at = instantAt(key, minutes);
    const offset = offsetAt(at);
    const wall = clinicWallClock(at);
    const abs = Math.abs(offset);
    return (
        `${wall.key}T${pad2(Math.floor(wall.minutes / 60))}:${pad2(wall.minutes % 60)}:00` +
        `${offset < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
    );
}

/**
 * The offset that puts the start of `key` at its midnight: what the server's
 * `offsetMinutes` means for a date. On the day summer time starts the clock
 * jumps at midnight, so the day begins on the old offset.
 */
export function offsetForDate(key: string): number {
    const { year, month, day } = keyParts(key);
    return Math.round((Date.UTC(year, month - 1, day) - instantAt(key, 0)) / MINUTE);
}

/** The clinic's offset now: what a request about "now" sends as `offsetMinutes`. */
export function clinicOffsetNow(): number {
    return offsetAt(clinicNow());
}

/** The clinic's day `key`, half open. 23 or 25 hours long across a DST change. */
export function clinicDayRange(key: string): { from: Date; to: Date } {
    return { from: new Date(instantAt(key, 0)), to: new Date(instantAt(addDays(key, 1), 0)) };
}

/**
 * The day `date` for a caller who said its day starts `offsetMinutes` east of
 * UTC. A caller on clinic time gets the clinic's day, so a late appointment on
 * the night the clocks go back is not dropped off its end. Any other offset is
 * taken as fixed, as it always was: a client that sends 0 means UTC days.
 *
 * Both of the day's offsets count as clinic time, because an app from before
 * `clinicTime` sent the offset its engine gave the first instant of the day,
 * which on the day summer time starts is the new one.
 */
export function dayRange(date: string, offsetMinutes = 0): { from: Date; to: Date } {
    const start = new Date(`${date}T00:00:00Z`).getTime();
    if (Number.isNaN(start)) throw new Error(`invalid date: ${date}`);

    if (offsetMinutes === offsetForDate(date) || offsetMinutes === offsetForDate(addDays(date, 1))) {
        return clinicDayRange(date);
    }
    const from = new Date(start - offsetMinutes * MINUTE);
    return { from, to: new Date(from.getTime() + DAY) };
}

function onClinicTime(at: number, offsetMinutes: number, now: number): boolean {
    return offsetMinutes === offsetAt(at) || offsetMinutes === offsetAt(now);
}

/**
 * `at` on the wall clock of a caller who sent `offsetMinutes` as its offset
 * now. A caller on clinic time reads it in the clinic's zone, which may be on
 * the other side of a DST change from now; any other offset is fixed.
 */
export function callerWallClock(
    at: Instant,
    offsetMinutes: number,
    now: number = clinicNow(),
): ClinicWallClock {
    const time = epoch(at);
    return wallClockAt(time, onClinicTime(time, offsetMinutes, now) ? offsetAt(time) : offsetMinutes);
}

/** The day a moment falls on, for a caller who sent its offset now; the same half-open range `dayRange` returns. */
export function clinicDayOf(
    at: Date,
    offsetMinutes = 0,
    now: number = clinicNow(),
): { from: Date; to: Date } {
    const time = at.getTime();
    if (onClinicTime(time, offsetMinutes, now)) return clinicDayRange(dateKey(time));
    return dayRange(callerWallClock(time, offsetMinutes, now).key, offsetMinutes);
}
