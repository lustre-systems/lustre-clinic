/**
 * The current time, in minutes since midnight, ticking. The day view is open
 * all day on a desk, so "now" is not the mount time — the now-line, the wait
 * counters and the countdown to the next patient all move. Half a minute is
 * fine for all of those: none of them shows seconds, and a per-second timer
 * driving a whole screen costs battery for nothing.
 *
 * `useNowSeconds` is the exception, and it is deliberately a second hook rather
 * than a faster `TICK_MS`. Only the chair's progress bar wants this — it is the
 * one thing on the screen a person watches to see whether it is moving — so the
 * per-second re-render is kept inside the component that draws it. Raising the
 * shared tick instead would re-render the agenda, the now-line and every card
 * sixty times a minute to animate one 5px bar.
 */
// biome-ignore lint/style/noRestrictedImports: a `setInterval` is the only thing that can move "now" — nothing renders or is tapped when the clock ticks past a minute
import { useEffect, useState } from 'react';
import { serverNow } from '../../api/serverClock';
import { minutesOfDay, secondsOfDay } from './time';

const TICK_MS = 30_000;
const SECOND_MS = 1_000;

function nowMinutes(): number {
    return minutesOfDay(serverNow());
}

/** Minutes since midnight carrying a fraction, so a caller can read seconds. */
function nowExact(): number {
    return secondsOfDay(serverNow()) / 60;
}

export function useNowMinutes(): number {
    const [minutes, setMinutes] = useState(nowMinutes);

    useEffect(() => {
        const timer = setInterval(() => setMinutes(nowMinutes()), TICK_MS);
        return () => clearInterval(timer);
    }, []);

    return minutes;
}

/**
 * Re-aimed at the wall clock every tick rather than run on `setInterval`.
 *
 * An interval's period is a floor, not a promise: each callback lands a little
 * after its thousand milliseconds, the lateness accumulates, and eventually two
 * ticks straddle the same second — the label reads `:59` then `:01` and a
 * second is gone. Sleeping to the *next* second boundary instead means every
 * tick corrects the last one's drift, so the count cannot skip however busy the
 * thread was.
 */
export function useNowSeconds(): number {
    const [minutes, setMinutes] = useState(nowExact);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;

        const untilNextSecond = () => SECOND_MS - (serverNow() % SECOND_MS);
        const tick = () => {
            setMinutes(nowExact());
            timer = setTimeout(tick, untilNextSecond());
        };

        timer = setTimeout(tick, untilNextSecond());
        return () => clearTimeout(timer);
    }, []);

    return minutes;
}
