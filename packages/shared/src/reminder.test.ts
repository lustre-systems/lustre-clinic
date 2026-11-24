import { describe, expect, test } from 'bun:test';
import { leadDaysOf, leadHoursOf, REMINDER_LEAD_MAX_DAYS, reminderDueCutoff } from './reminder.ts';

const CAIRO = 180;

function at(iso: string): Date {
    return new Date(iso);
}

describe('reminderDueCutoff', () => {
    test('before the notify time, only what is due by now', () => {
        const now = at('2026-09-28T13:59:00Z');
        expect(reminderDueCutoff({ now, notifyAt: '17:00', offsetMinutes: CAIRO })).toEqual(now);
    });

    test('from the notify time, everything due before local midnight', () => {
        const cutoff = reminderDueCutoff({
            now: at('2026-09-28T14:00:00Z'),
            notifyAt: '17:00',
            offsetMinutes: CAIRO,
        });
        expect(cutoff.toISOString()).toBe('2026-09-28T20:59:59.999Z');
    });

    test('reads the seconds form Postgres returns', () => {
        const cutoff = reminderDueCutoff({
            now: at('2026-09-28T14:00:00Z'),
            notifyAt: '17:00:00',
            offsetMinutes: CAIRO,
        });
        expect(cutoff.toISOString()).toBe('2026-09-28T20:59:59.999Z');
    });

    test('with throughToday, the end of the day even before the notify time', () => {
        const cutoff = reminderDueCutoff({
            now: at('2026-09-28T06:00:00Z'),
            notifyAt: '17:00',
            offsetMinutes: CAIRO,
            throughToday: true,
        });
        expect(cutoff.toISOString()).toBe('2026-09-28T20:59:59.999Z');
    });

    test('the day is the local one, not the UTC one', () => {
        const now = at('2026-09-28T22:30:00Z');
        expect(reminderDueCutoff({ now, notifyAt: '17:00', offsetMinutes: CAIRO })).toEqual(now);

        const late = reminderDueCutoff({
            now: at('2026-09-28T20:30:00Z'),
            notifyAt: '17:00',
            offsetMinutes: CAIRO,
        });
        expect(late.toISOString()).toBe('2026-09-28T20:59:59.999Z');
    });

    test('a negative offset places the day west of UTC', () => {
        const cutoff = reminderDueCutoff({
            now: at('2026-09-29T01:00:00Z'),
            notifyAt: '17:00',
            offsetMinutes: -240,
        });
        expect(cutoff.toISOString()).toBe('2026-09-29T03:59:59.999Z');
    });
});

describe('lead days', () => {
    test('shows the stored hours as whole days, between one and the maximum', () => {
        expect(leadDaysOf(24)).toBe(1);
        expect(leadDaysOf(48)).toBe(2);
        expect(leadDaysOf(6)).toBe(1);
        expect(leadDaysOf(0)).toBe(1);
        expect(leadDaysOf(40)).toBe(2);
        expect(leadDaysOf(24 * 14)).toBe(REMINDER_LEAD_MAX_DAYS);
    });

    test('writes days back as hours', () => {
        expect(leadHoursOf(1)).toBe(24);
        expect(leadHoursOf(3)).toBe(72);
    });
});
