import type { ClinicZone } from './clinicTime.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function utcOffsetMinutes(timeZone: string, at: Date): number {
    return offsetReader(timeZone)(at.getTime());
}

function offsetReader(timeZone: string): (at: number) => number {
    const format = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
    });
    return (at) => {
        const parts = format.formatToParts(new Date(at));
        const field = (type: Intl.DateTimeFormatPartTypes) =>
            Number(parts.find((part) => part.type === type)?.value);
        const wall = Date.UTC(
            field('year'),
            field('month') - 1,
            field('day'),
            field('hour'),
            field('minute'),
            field('second'),
        );
        return Math.round((wall - Math.floor(at / 1000) * 1000) / MINUTE);
    };
}

export function zoneSpans(timeZone: string, from: number, to: number): ClinicZone {
    const offsetAt = offsetReader(timeZone);
    const spans: [number, number][] = [[from, offsetAt(from)]];

    for (let at = from + DAY; at < to + DAY; at += DAY) {
        const before = spans[spans.length - 1]?.[1];
        const offset = offsetAt(at);
        if (offset === before) continue;

        let low = at - DAY;
        let high = at;
        while (high - low > MINUTE) {
            const middle = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
            if (offsetAt(middle) === before) low = middle;
            else high = middle;
        }
        spans.push([high, offset]);
    }

    return { zone: timeZone, spans };
}
