import { setClinicClock, todayKey } from '@lustre/shared';

export interface ClockSample {
    wall: number;
    mono: number;
}

export function clockSample(): ClockSample {
    return { wall: Date.now(), mono: performance.now() };
}

export const CLOCK_JUMP_TOLERANCE_MS = 2_000;

let skewMs = 0;
let measuredAt: ClockSample | null = null;
const skewListeners = new Set<() => void>();

export function noteServerClock(skew: number, at: ClockSample = clockSample()): void {
    const moved = Math.round(skew / 60_000) !== skewMinutes();
    skewMs = skew;
    measuredAt = at;
    if (moved) for (const listener of skewListeners) listener();
}

export function skewMinutes(): number {
    return Math.round(skewMs / 60_000);
}

export function subscribeSkew(listener: () => void): () => void {
    skewListeners.add(listener);
    return () => skewListeners.delete(listener);
}

export function serverNow(now: ClockSample = clockSample()): number {
    if (measuredAt && now.wall - measuredAt.wall < now.mono - measuredAt.mono - CLOCK_JUMP_TOLERANCE_MS) {
        skewMs = 0;
        measuredAt = null;
    }
    return now.wall + skewMs;
}

setClinicClock(() => serverNow());

export function serverToday(): string {
    return todayKey(serverNow());
}

export function serverTimeOf(instant: number, now: ClockSample = clockSample()): number {
    return instant + (serverNow(now) - now.wall);
}

export function phoneTimeOf(instant: number, now: ClockSample = clockSample()): number {
    return instant - (serverNow(now) - now.wall);
}
