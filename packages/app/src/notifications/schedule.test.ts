/**
 * The nudge rule, at its edges. This is the whole of what `bun test` can reach —
 * `notifications.ts` is `expo-notifications` and needs a device — so the rule
 * is deliberately the part that holds the decisions.
 *
 * `PRODUCT.md:96`, restated: at the notify time, if reminders are pending, buzz;
 * repeat every N minutes until the list is empty or dismissed for the day; stop
 * overnight.
 */
import { describe, expect, it } from 'bun:test';
import { instantAt } from '@lustre/shared';
import { minutesOfClock, planNudges } from './schedule';

/** `HH:MM` on a clinic day, as the instant the clinic's clock reads it. */
function clinic(key: string, hours: number, minutes = 0): number {
    return instantAt(key, hours * 60 + minutes);
}

const AT_NOON = clinic('2026-08-27', 12);

function plan(over: Partial<Parameters<typeof planNudges>[0]> = {}) {
    return planNudges({
        notifyAt: 19 * 60,
        repeatMinutes: 30,
        pendingCount: 3,
        dismissedOn: null,
        today: '2026-08-27',
        now: AT_NOON,
        ...over,
    });
}

describe('planNudges', () => {
    it('starts at the notify time and repeats until midnight', () => {
        const { at, silent } = plan();

        expect(silent).toBe('pending');
        expect(at[0]).toEqual(new Date(clinic('2026-08-27', 19)));
        expect(at[1]).toEqual(new Date(clinic('2026-08-27', 19, 30)));
        expect(at.at(-1)).toEqual(new Date(clinic('2026-08-27', 23, 30)));
        // 19:00 to 23:30 inclusive, every half hour.
        expect(at).toHaveLength(10);
    });

    it('arms nothing when no reminder is pending', () => {
        expect(plan({ pendingCount: 0 })).toEqual({ at: [], silent: 'none-pending' });
    });

    it('arms nothing once the day has been dismissed', () => {
        expect(plan({ dismissedOn: '2026-08-27' })).toEqual({ at: [], silent: 'dismissed' });
    });

    it('arms again the day after a dismissal, without being told to', () => {
        const { at, silent } = plan({ dismissedOn: '2026-08-26' });

        expect(silent).toBe('pending');
        expect(at).not.toHaveLength(0);
    });

    it('never schedules a slot that has already passed', () => {
        // Foregrounded at 21:10. The 19:00, 19:30, 20:00, 20:30 and 21:00 slots
        // are gone; scheduling them would buzz five times on the spot.
        const { at } = plan({ now: clinic('2026-08-27', 21, 10) });

        expect(at[0]).toEqual(new Date(clinic('2026-08-27', 21, 30)));
        expect(at).toHaveLength(5);
    });

    it('goes quiet rather than into the small hours', () => {
        const { at, silent } = plan({
            notifyAt: 20 * 60,
            repeatMinutes: 120,
            now: clinic('2026-08-27', 23, 45),
        });

        expect(at).toEqual([]);
        expect(silent).toBe('past-midnight');
    });

    it('caps the series, so a 6am start every quarter hour is not 72 alarms', () => {
        const { at } = plan({ notifyAt: 6 * 60, repeatMinutes: 15, now: clinic('2026-08-27', 5) });

        expect(at.length).toBeLessThanOrEqual(24);
        expect(at[0]).toEqual(new Date(clinic('2026-08-27', 6)));
    });

    // 7 pm in Cairo is 16:00 UTC in summer, whatever zone the phone is set to.
    it("fires at the clinic's notify time, not the phone zone's", () => {
        const { at } = plan();

        expect(at[0]?.toISOString()).toBe('2026-08-27T16:00:00.000Z');
    });

    // The night summer time ends: 24:00 at +3 becomes 23:00 at +2, so the
    // last hour of the clinic's Thursday runs twice. The series still ends at
    // midnight, and every slot is a distinct instant on the right side of it.
    it("keeps the clinic's times across the end of summer time", () => {
        const { at } = plan({
            today: '2026-10-29',
            notifyAt: 22 * 60,
            repeatMinutes: 30,
            now: clinic('2026-10-29', 12),
        });

        expect(at.map((date) => date.toISOString())).toEqual([
            '2026-10-29T19:00:00.000Z',
            '2026-10-29T19:30:00.000Z',
            '2026-10-29T20:00:00.000Z',
            '2026-10-29T20:30:00.000Z',
        ]);
        const next = plan({ today: '2026-10-30', notifyAt: 19 * 60, now: clinic('2026-10-30', 12) });
        expect(next.at[0]?.toISOString()).toBe('2026-10-30T17:00:00.000Z');
    });

    it('survives a repeat of zero rather than looping forever', () => {
        const { at } = plan({ repeatMinutes: 0 });

        expect(at.length).toBeLessThanOrEqual(24);
    });
});

describe('minutesOfClock', () => {
    it('reads the HH:MM the settings column returns', () => {
        expect(minutesOfClock('19:00')).toBe(19 * 60);
        expect(minutesOfClock('06:30')).toBe(6 * 60 + 30);
        expect(minutesOfClock('00:00')).toBe(0);
    });

    it('clamps rather than letting a bad value wrap the day', () => {
        expect(minutesOfClock('25:00')).toBe(24 * 60 - 1);
        expect(minutesOfClock('nonsense')).toBe(0);
    });
});
