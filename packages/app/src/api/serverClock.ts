/**
 * The clinic server's clock, as this phone best knows it. Every stamp the app
 * measures against — a check-in, a seat in the chair, a backup — was written
 * by the server, so "now" is read here and not off `Date.now()`: a phone wound
 * an hour forward would otherwise find every check-in an hour old the instant
 * it arrived, and draw a walk-in seated a minute ago as an hour over.
 *
 * It is `clinicTime`'s "now" too (`setClinicClock` below), so today's key, the
 * day's timers and every booking decision read the server's clock. Anything the
 * OS fires by the phone's own clock, such as a scheduled local notification, is
 * moved onto it with `phoneTimeOf`.
 *
 * The skew is measured by the clock check (`shell/clockCheck.ts`). Until it
 * has answered, the phone's own clock is all there is. No imports but
 * `@lustre/shared`, so Bun can test what reads it without React Native.
 */
import { setClinicClock, todayKey } from '@lustre/shared';

/**
 * One reading of both of the phone's clocks. `mono` never jumps when the
 * phone's time is set, which is how a correction after a measurement shows.
 */
export interface ClockSample {
    wall: number;
    mono: number;
}

export function clockSample(): ClockSample {
    return { wall: Date.now(), mono: performance.now() };
}

/** Timer lateness and rounding between the two clocks, well under any correction worth catching. */
export const CLOCK_JUMP_TOLERANCE_MS = 2_000;

let skewMs = 0;
let measuredAt: ClockSample | null = null;
const skewListeners = new Set<() => void>();

/** How far the server's clock is ahead of this phone's; negative when behind. */
export function noteServerClock(skew: number, at: ClockSample = clockSample()): void {
    const moved = Math.round(skew / 60_000) !== skewMinutes();
    skewMs = skew;
    measuredAt = at;
    if (moved) for (const listener of skewListeners) listener();
}

/**
 * The skew to the minute, for what has to be redone when it moves: alarms the
 * OS fires by the phone's clock were armed against the old one.
 */
export function skewMinutes(): number {
    return Math.round(skewMs / 60_000);
}

export function subscribeSkew(listener: () => void): () => void {
    skewListeners.add(listener);
    return () => skewListeners.delete(listener);
}

/**
 * The offset is dropped when the phone's clock has been set back since it was
 * measured: the usual fix for a fast phone, after which the phone is right and
 * the old offset would make it an hour slow. A jump forward is not caught —
 * the monotonic clock stops while the phone sleeps, so a phone waking from a
 * pocket looks the same, and that is exactly when a check-in must still be
 * aged right. The next measurement, at most five minutes on or on the next
 * foreground, puts either right.
 */
export function serverNow(now: ClockSample = clockSample()): number {
    if (measuredAt && now.wall - measuredAt.wall < now.mono - measuredAt.mono - CLOCK_JUMP_TOLERANCE_MS) {
        skewMs = 0;
        measuredAt = null;
    }
    return now.wall + skewMs;
}

setClinicClock(() => serverNow());

/** Today's `YYYY-MM-DD` by the server's clock, in the clinic's zone like every other key. */
export function serverToday(): string {
    return todayKey(serverNow());
}

/** What the server's clock read when the phone's read `instant`: a stamp the phone took itself. */
export function serverTimeOf(instant: number, now: ClockSample = clockSample()): number {
    return instant + (serverNow(now) - now.wall);
}

/** When the phone's own clock will read `instant` on the server's: what an OS alarm is armed for. */
export function phoneTimeOf(instant: number, now: ClockSample = clockSample()): number {
    return instant - (serverNow(now) - now.wall);
}
