/**
 * How far this phone's clock is from the clinic server's. The app reads "now"
 * off the server's clock (`api/serverClock`), so a phone wound an hour forward
 * to hide a wrong zone neither books an hour out nor shows a walk-in seated a
 * minute ago as an hour over.
 */

import { CLOCK_JUMP_TOLERANCE_MS, type ClockSample } from '../api/serverClock';

/** A reply slower than this says too little about when the server read its clock. */
const MAX_ROUND_TRIP_MS = 30_000;

/**
 * How far the server's clock is ahead of the phone's, or null when the reading
 * says too little: a reply too slow to place, or the phone's time set while the
 * request was out, which shows as the wall clock and the monotonic one
 * disagreeing about how long it took.
 */
export function clockSkew(serverNow: number, sent: ClockSample, received: ClockSample): number | null {
    const elapsed = received.wall - sent.wall;
    if (elapsed < 0 || elapsed > MAX_ROUND_TRIP_MS) return null;
    if (Math.abs(elapsed - (received.mono - sent.mono)) > CLOCK_JUMP_TOLERANCE_MS) return null;
    // The server read its clock somewhere inside the round trip; the midpoint
    // is the best guess, off by at most half of it.
    return serverNow - (sent.wall + received.wall) / 2;
}
