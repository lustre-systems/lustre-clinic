import { afterEach, describe, expect, it } from 'bun:test';
import { dateKey, instantAt } from '@lustre/shared';
import { todayKey } from '../screens/day/time';
import { noteServerClock, phoneTimeOf, serverNow, serverToday } from './serverClock';

const HOUR = 60 * 60_000;

describe('the server clock', () => {
    afterEach(() => noteServerClock(0));

    it('is the phone clock until the clock check has measured the skew', () => {
        expect(serverNow({ wall: 1_000, mono: 1_000 })).toBe(1_000);
    });

    it('takes the measured skew off a phone that runs fast', () => {
        noteServerClock(-HOUR, { wall: 5 * HOUR, mono: 0 });
        expect(serverNow({ wall: 5 * HOUR + 60_000, mono: 60_000 })).toBe(4 * HOUR + 60_000);
    });

    // The fix the banner asks for: the fast phone's time is set right. The old
    // offset would now make it an hour slow, and let stale notices through.
    it('drops the offset once the phone clock is set back', () => {
        noteServerClock(-HOUR, { wall: 5 * HOUR, mono: 0 });
        const corrected = { wall: 4 * HOUR + 60_000, mono: 60_000 };
        expect(serverNow(corrected)).toBe(corrected.wall);
        // And stays dropped: the next reading is measured afresh, not re-derived.
        expect(serverNow({ wall: corrected.wall + 1_000, mono: 61_000 })).toBe(corrected.wall + 1_000);
    });

    // A phone asleep in a pocket: the wall clock ran on, the monotonic one did
    // not. That is when a check-in wakes it, so the offset must still apply.
    it('keeps the offset across sleep', () => {
        noteServerClock(-HOUR, { wall: 5 * HOUR, mono: 0 });
        expect(serverNow({ wall: 6 * HOUR, mono: 60_000 })).toBe(5 * HOUR);
    });

    // A phone an hour fast reads 00:30 while the clinic is still at 23:30: the
    // day list, the day's keys and "today" labels all have to stay on yesterday.
    it('keeps today on the server side of midnight, for the day cluster too', () => {
        const phone = instantAt(dateKey(Date.now()), 30);
        const clinic = phone - HOUR;
        noteServerClock(clinic - Date.now());

        expect(serverToday()).toBe(dateKey(clinic));
        expect(todayKey()).toBe(dateKey(clinic));
        expect(todayKey()).not.toBe(dateKey(phone));
    });

    // An OS alarm fires by the phone's clock: on a phone an hour fast, 7 pm
    // clinic time is when the phone reads 8 pm.
    it('moves an instant onto the phone clock for the OS to fire at', () => {
        noteServerClock(-HOUR, { wall: 5 * HOUR, mono: 0 });
        expect(phoneTimeOf(10 * HOUR, { wall: 5 * HOUR, mono: 0 })).toBe(11 * HOUR);
    });
});
