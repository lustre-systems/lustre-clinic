/**
 * The clinic's clock, from the bundled Africa/Cairo table. Every expectation is
 * an absolute instant, so the suite means the same under any `TZ`; CI and the
 * PR check run it as Africa/Cairo, UTC and Asia/Tokyo.
 *
 * Cairo is +2, and +3 from midnight on the last Friday of April (24 April
 * 2026) to midnight at the end of the last Thursday of October (29 October
 * 2026), when 24:00 becomes 23:00 again.
 */
import { describe, expect, it } from 'bun:test';
import {
    callerWallClock,
    clinicDayOf,
    clinicDayRange,
    clinicWallClock,
    dateKey,
    dayRange,
    instantAt,
    isoAt,
    offsetAt,
    offsetForDate,
    parseClinicZone,
} from './clinicTime.ts';
import { reminderDueCutoff } from './reminder.ts';

const at = (iso: string) => Date.parse(iso);
const HOUR = 3_600_000;

describe('an instant on the clinic clock', () => {
    // The bug: the phone thought Cairo was +2 and was wound forward an hour.
    // 5:30 pm on 6 October 2026 is 14:30 UTC, whatever the phone says.
    it('books 5:30 as 5:30 in the clinic', () => {
        expect(isoAt('2026-10-06', 17 * 60 + 30)).toBe('2026-10-06T17:30:00+03:00');
        expect(new Date(instantAt('2026-10-06', 17 * 60 + 30)).toISOString()).toBe(
            '2026-10-06T14:30:00.000Z',
        );
        expect(clinicWallClock(at('2026-10-06T14:30:00Z'))).toMatchObject({
            key: '2026-10-06',
            minutes: 17 * 60 + 30,
            weekday: 2,
        });
    });

    it('follows the season', () => {
        expect(offsetAt(at('2026-09-24T12:00:00Z'))).toBe(180);
        expect(offsetAt(at('2026-12-24T12:00:00Z'))).toBe(120);
        expect(isoAt('2026-12-24', 10 * 60)).toBe('2026-12-24T10:00:00+02:00');
    });

    it('changes offset at the minute the clocks do', () => {
        expect(offsetAt(at('2026-04-23T21:59:00Z'))).toBe(120);
        expect(offsetAt(at('2026-04-23T22:00:00Z'))).toBe(180);
        expect(offsetAt(at('2026-10-29T20:59:00Z'))).toBe(180);
        expect(offsetAt(at('2026-10-29T21:00:00Z'))).toBe(120);
    });

    it('reads the day, weekday and seconds', () => {
        const wall = clinicWallClock('2026-10-29T21:30:15Z');
        expect(wall).toEqual({
            key: '2026-10-29',
            year: 2026,
            month: 10,
            day: 29,
            weekday: 4,
            minutes: 23 * 60 + 30,
            seconds: (23 * 60 + 30) * 60 + 15,
        });
    });

    // 00:30 on the 15th in Cairo is 21:30 UTC on the 14th.
    it('puts a time just after midnight on the clinic day, not the UTC one', () => {
        expect(dateKey('2026-09-14T21:30:00Z')).toBe('2026-09-15');
    });
});

describe('a clinic time as an instant', () => {
    // The clock jumps from 00:00 to 01:00 on 24 April.
    it('reads a skipped time as the same time after the jump', () => {
        expect(new Date(instantAt('2026-04-24', 30)).toISOString()).toBe('2026-04-23T22:30:00.000Z');
        expect(instantAt('2026-04-24', 0)).toBe(at('2026-04-23T22:00:00Z'));
    });

    // 23:00–24:00 on 29 October happens twice.
    it('takes the first of a time shown twice', () => {
        expect(new Date(instantAt('2026-10-29', 23 * 60 + 30)).toISOString()).toBe(
            '2026-10-29T20:30:00.000Z',
        );
        expect(isoAt('2026-10-29', 23 * 60 + 30)).toBe('2026-10-29T23:30:00+03:00');
    });

    it('round-trips every quarter hour of a normal day', () => {
        for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
            const wall = clinicWallClock(instantAt('2026-07-01', minutes));
            expect([wall.key, wall.minutes]).toEqual(['2026-07-01', minutes]);
        }
    });
});

describe('the clinic day', () => {
    it('is the offset that starts it, for the server', () => {
        expect(offsetForDate('2026-04-23')).toBe(120);
        // Starts at 00:00 +2, which is the instant the clock jumps to 01:00 +3.
        expect(offsetForDate('2026-04-24')).toBe(120);
        expect(offsetForDate('2026-04-25')).toBe(180);
        expect(offsetForDate('2026-10-29')).toBe(180);
        expect(offsetForDate('2026-10-30')).toBe(120);
    });

    it('is 23 hours when summer time starts and 25 when it ends', () => {
        const spring = clinicDayRange('2026-04-24');
        expect(spring.to.getTime() - spring.from.getTime()).toBe(23 * HOUR);
        const autumn = clinicDayRange('2026-10-29');
        expect(autumn.from.toISOString()).toBe('2026-10-28T21:00:00.000Z');
        expect(autumn.to.toISOString()).toBe('2026-10-29T22:00:00.000Z');
    });

    // 23:30 the second time round, at +2, is 21:30 UTC: past where a fixed +3
    // day would end, and before the next day starts. It must be on the 29th.
    it('keeps a late appointment on the night the clocks go back', () => {
        const late = new Date('2026-10-29T21:30:00Z');
        const thursday = dayRange('2026-10-29', offsetForDate('2026-10-29'));
        const friday = dayRange('2026-10-30', offsetForDate('2026-10-30'));
        expect(late >= thursday.from && late < thursday.to).toBe(true);
        expect(late >= friday.from && late < friday.to).toBe(false);
        expect(clinicDayOf(late, 120, late.getTime())).toEqual(thursday);
    });

    // An app from before clinicTime sends the offset its engine gave the first
    // instant of 24 April, which is +3. It gets the clinic's day too, rather
    // than one that starts at 23:00 on the 23rd.
    it("counts an older app's offset for the day as clinic time", () => {
        expect(dayRange('2026-04-24', 180)).toEqual(clinicDayRange('2026-04-24'));
        expect(dayRange('2026-04-23', 120)).toEqual(clinicDayRange('2026-04-23'));
    });

    it('takes any other offset as fixed, as it always did', () => {
        expect(dayRange('2026-10-29', 0)).toEqual({
            from: new Date('2026-10-29T00:00:00Z'),
            to: new Date('2026-10-30T00:00:00Z'),
        });
        expect(dayRange('2026-10-29', 540).from.toISOString()).toBe('2026-10-28T15:00:00.000Z');
        expect(() => dayRange('not-a-date', 0)).toThrow();
    });

    it('reads a caller on clinic time in the clinic zone, across the change', () => {
        // Sent in October at +3, about an appointment in November at +2.
        const november = at('2026-11-02T15:30:00Z');
        expect(callerWallClock(november, 180, at('2026-10-06T09:00:00Z'))).toMatchObject({
            key: '2026-11-02',
            minutes: 17 * 60 + 30,
        });
        // A caller on a fixed offset is read on it.
        expect(callerWallClock(november, 0, at('2026-10-06T09:00:00Z'))).toMatchObject({
            key: '2026-11-02',
            minutes: 15 * 60 + 30,
        });
    });
});

describe('the reminder cutoff', () => {
    // From the notify time on, the cutoff is the end of the clinic's day. On
    // the 29th of October that is 24:00 at +2, not at +3.
    it('runs to the end of the long day the clocks go back', () => {
        const cutoff = reminderDueCutoff({
            now: new Date('2026-10-29T17:00:00Z'),
            notifyAt: '19:00',
            offsetMinutes: 180,
        });
        expect(cutoff.toISOString()).toBe('2026-10-29T21:59:59.999Z');
    });

    it('is now before the notify time', () => {
        const now = new Date('2026-10-29T13:00:00Z');
        expect(reminderDueCutoff({ now, notifyAt: '19:00', offsetMinutes: 180 })).toEqual(now);
    });
});

describe('a table off the wire', () => {
    it('is taken when it is one', () => {
        const zone = {
            zone: 'Africa/Cairo',
            spans: [
                [0, 120],
                [1_000, 180],
            ],
        };
        expect(parseClinicZone(zone)).toEqual(zone as never);
    });

    it('is refused when it is not', () => {
        expect(parseClinicZone(undefined)).toBeNull();
        expect(parseClinicZone({ zone: 'x', spans: [] })).toBeNull();
        expect(
            parseClinicZone({
                zone: 'x',
                spans: [
                    [1_000, 120],
                    [0, 180],
                ],
            }),
        ).toBeNull();
        expect(parseClinicZone({ zone: 'x', spans: [[0, 99_999]] })).toBeNull();
        expect(parseClinicZone({ zone: 'x', spans: [[0, '120']] })).toBeNull();
    });
});
