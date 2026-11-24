import { CLOCK_JUMP_TOLERANCE_MS, type ClockSample } from '../api/serverClock';

const MAX_ROUND_TRIP_MS = 30_000;

export function clockSkew(serverNow: number, sent: ClockSample, received: ClockSample): number | null {
    const elapsed = received.wall - sent.wall;
    if (elapsed < 0 || elapsed > MAX_ROUND_TRIP_MS) return null;
    if (Math.abs(elapsed - (received.mono - sent.mono)) > CLOCK_JUMP_TOLERANCE_MS) return null;
    return serverNow - (sent.wall + received.wall) / 2;
}
