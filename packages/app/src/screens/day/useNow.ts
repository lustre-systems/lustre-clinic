// biome-ignore lint/style/noRestrictedImports: a `setInterval` is the only thing that can move "now" — nothing renders or is tapped when the clock ticks past a minute
import { useEffect, useState } from 'react';
import { serverNow } from '../../api/serverClock';
import { minutesOfDay, secondsOfDay } from './time';

const TICK_MS = 30_000;
const SECOND_MS = 1_000;

function nowMinutes(): number {
    return minutesOfDay(serverNow());
}

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
