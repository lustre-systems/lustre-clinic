import { describe, expect, it } from 'bun:test';
import { setRuntimeLocale } from '../../i18n/runtime';

const plain = (text: string) => text.replace(/[\u2068\u2069]/g, '');

import {
    clock12,
    formatClock12,
    formatDuration,
    formatElapsed,
    formatSpan,
    formatStamp,
    formatTime12,
    minutesOfDay,
    time12,
} from './clock';

describe('12-hour clock', () => {
    it('turns the hour over at noon and midnight rather than showing 0 or 13', () => {
        expect(clock12(0)).toEqual({ time: '12:00', meridiem: 'AM' });
        expect(clock12(12 * 60)).toEqual({ time: '12:00', meridiem: 'PM' });
        expect(clock12(13 * 60)).toEqual({ time: '1:00', meridiem: 'PM' });
        expect(clock12(23 * 60 + 59)).toEqual({ time: '11:59', meridiem: 'PM' });
    });

    it('pads the minute and never the hour', () => {
        expect(clock12(9 * 60 + 5)).toEqual({ time: '9:05', meridiem: 'AM' });
        expect(clock12(14 * 60 + 15)).toEqual({ time: '2:15', meridiem: 'PM' });
    });

    it('wraps rather than running past midnight', () => {
        expect(clock12(24 * 60)).toEqual({ time: '12:00', meridiem: 'AM' });
        expect(clock12(25 * 60 + 30)).toEqual({ time: '1:30', meridiem: 'AM' });
        expect(clock12(-30)).toEqual({ time: '11:30', meridiem: 'PM' });
    });

    it('is never 24-hour, at any minute of the day', () => {
        for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
            const hour = Number(clock12(minutes).time.split(':')[0]);
            expect(hour).toBeGreaterThanOrEqual(1);
            expect(hour).toBeLessThanOrEqual(12);
        }
    });
});

describe('the meridiem localizes and the digits do not', () => {
    it('marks Arabic with ص and م', () => {
        expect(clock12(9 * 60, 'ar')).toEqual({ time: '9:00', meridiem: 'ص' });
        expect(clock12(18 * 60, 'ar')).toEqual({ time: '6:00', meridiem: 'م' });
    });

    it('keeps Latin numerals in Arabic (§7.11 — DM Mono has no Arabic-Indic)', () => {
        for (const minutes of [0, 7 * 60 + 45, 12 * 60, 22 * 60 + 30]) {
            expect(clock12(minutes, 'ar').time).toBe(clock12(minutes, 'en').time);
        }
    });

    it('defaults to English when no locale is passed', () => {
        expect(clock12(18 * 60).meridiem).toBe('PM');
    });
});

describe('the one-string forms', () => {
    it('joins the figure and the marker', () => {
        expect(formatClock12(18 * 60)).toBe('6:00 PM');
        expect(formatClock12(18 * 60, 'ar')).toBe('6:00 م');
    });

    it('keeps the meridiem on both ends of a span', () => {
        expect(formatSpan(10 * 60, 18 * 60)).toBe('10:00 AM – 6:00 PM');
        expect(formatSpan(10 * 60, 11 * 60)).toBe('10:00 AM – 11:00 AM');
        expect(formatSpan(10 * 60, 18 * 60, 'ar')).toBe('10:00 ص – 6:00 م');
    });
});

describe('off a timestamp', () => {
    const at = new Date('2026-06-12T11:15:00Z');

    it('reads the local wall clock', () => {
        expect(formatStamp(at.getTime())).toBe('2:15 PM');
        expect(formatStamp(at.getTime(), 'ar')).toBe('2:15 م');
    });

    it('agrees with the ISO forms', () => {
        const iso = at.toISOString();
        expect(minutesOfDay(iso)).toBe(14 * 60 + 15);
        expect(time12(iso)).toEqual({ time: '2:15', meridiem: 'PM' });
        expect(formatTime12(iso)).toBe('2:15 PM');
    });
});

describe('a length of time', () => {
    it('stays in minutes below the hour and turns over above it', () => {
        expect(formatDuration(0)).toBe('0 min');
        expect(formatDuration(59)).toBe('59 min');
        expect(formatDuration(60)).toBe('1h 0m');
        expect(formatDuration(223)).toBe('3h 43m');
    });

    it('turns over the waits and countdowns the day cards used to print in minutes', () => {
        expect(formatDuration(467)).toBe('7h 47m');
        expect(formatDuration(127)).toBe('2h 7m');
        expect(formatDuration(341)).toBe('5h 41m');
    });

    it('takes the language from the caller, and reads the app otherwise', () => {
        setRuntimeLocale('ar');
        try {
            expect(plain(formatDuration(30))).toBe('30 دقيقة');
            expect(formatDuration(30, 'en')).toBe('30 min');
            expect(formatDuration(90, 'en')).toBe('1h 30m');
        } finally {
            setRuntimeLocale('en');
        }
    });
});

describe('a count that is running', () => {
    it('keeps two digits on the seconds so the label does not jump width', () => {
        expect(formatElapsed(0)).toBe('0:00');
        expect(formatElapsed(7)).toBe('0:07');
        expect(formatElapsed(70)).toBe('1:10');
        expect(formatElapsed(754)).toBe('12:34');
    });

    it('grows an hours field rather than counting past 59 minutes', () => {
        expect(formatElapsed(3_599)).toBe('59:59');
        expect(formatElapsed(3_600)).toBe('1:00:00');
        expect(formatElapsed(4_503)).toBe('1:15:03');
    });

    it('truncates rather than rounds, and never counts below zero', () => {
        expect(formatElapsed(59.9)).toBe('0:59');
        expect(formatElapsed(-30)).toBe('0:00');
    });

    it('assembles the count left to right, whatever the layout direction', () => {
        expect(formatElapsed(3)).toBe('0:03');
        expect(formatElapsed(2)).toBe('0:02');
        expect(formatElapsed(319)).toBe('5:19');
    });

    it('never leaves the stopwatch shape, second by second', () => {
        for (let second = 0; second <= 4_000; second += 1) {
            expect(formatElapsed(second)).toMatch(/^(?:\d+:)?\d{1,2}:\d{2}$/);
        }
    });
});
