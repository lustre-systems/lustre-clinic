import { BUNDLED_CLINIC_ZONE } from './clinicZone.bundled.ts';
import { addDays, keyParts, pad2 } from './dates.ts';

export interface ClinicZone {
    zone: string;
    spans: [number, number][];
}

export interface ClinicWallClock {
    key: string;
    year: number;
    month: number;
    day: number;
    weekday: number;
    minutes: number;
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

export function clinicNow(): number {
    return clock();
}

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

export function offsetAt(at: Instant): number {
    const time = epoch(at);
    const { spans } = zone;
    let low = 0;
    let high = spans.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((spans[middle]?.[0] ?? 0) <= time) low = middle;
        else high = middle - 1;
    }
    return spans[low]?.[1] ?? 0;
}

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

export function offsetForDate(key: string): number {
    const { year, month, day } = keyParts(key);
    return Math.round((Date.UTC(year, month - 1, day) - instantAt(key, 0)) / MINUTE);
}

export function clinicOffsetNow(): number {
    return offsetAt(clinicNow());
}

export function clinicDayRange(key: string): { from: Date; to: Date } {
    return { from: new Date(instantAt(key, 0)), to: new Date(instantAt(addDays(key, 1), 0)) };
}

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
    const startOfDay = offsetForDate(dateKey(at));
    return (
        offsetMinutes === offsetAt(at) ||
        offsetMinutes === offsetAt(now) ||
        (offsetMinutes === startOfDay && startOfDay > offsetAt(at))
    );
}

export function callerWallClock(
    at: Instant,
    offsetMinutes: number,
    now: number = clinicNow(),
): ClinicWallClock {
    const time = epoch(at);
    return wallClockAt(time, onClinicTime(time, offsetMinutes, now) ? offsetAt(time) : offsetMinutes);
}

export function clinicDayOf(
    at: Date,
    offsetMinutes = 0,
    now: number = clinicNow(),
): { from: Date; to: Date } {
    const time = at.getTime();
    if (onClinicTime(time, offsetMinutes, now)) return clinicDayRange(dateKey(time));
    return dayRange(callerWallClock(time, offsetMinutes, now).key, offsetMinutes);
}
