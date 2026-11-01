/**
 * "Can't cancel a future booking": what a booking on a later day offers, and
 * that cancelling it gives its time back to the booking grid. The sheet and the
 * booking page both read `bookingActions`, so this is the rule either screen
 * draws; the writes themselves are tested against both backends
 * (`packages/server/tests/modules.test.ts`, `api/demo/demo.test.ts`).
 */
import { describe, expect, it } from 'bun:test';
import type { AppointmentStatus } from '@lustre/shared';
import { bookingActions } from './actions';
import { slotsFor } from './booking';
import type { Appointment } from './data/types';
import { addDays, isoAt, weekdayOf } from './time';

const TODAY = '2026-08-10';
const THURSDAY = addDays(TODAY, 3);

const on = (day: string, status: AppointmentStatus = 'booked') => ({ status, startsAt: isoAt(day, 600) });

describe('bookingActions', () => {
    it('lets a booking on a later day be cancelled and moved', () => {
        const actions = bookingActions(on(THURSDAY), TODAY);

        expect(actions.cancel).toBe(true);
        expect(actions.reschedule).toBe(true);
    });

    it('offers no check-in or no-show before the day has come', () => {
        const actions = bookingActions(on(THURSDAY), TODAY);

        expect(actions.checkIn).toBe(false);
        expect(actions.noShow).toBe(false);
    });

    it('offers everything on the booking’s own day', () => {
        expect(bookingActions(on(TODAY), TODAY)).toEqual({
            checkIn: true,
            reschedule: true,
            noShow: true,
            cancel: true,
        });
    });

    it('lets a missed booking from an earlier day be resolved but not checked in', () => {
        const actions = bookingActions(on(addDays(TODAY, -2)), TODAY);

        expect(actions.checkIn).toBe(false);
        expect(actions.noShow).toBe(true);
        expect(actions.cancel).toBe(true);
    });

    it('offers nothing once the booking is no longer booked', () => {
        for (const status of ['checked_in', 'awaiting_payment', 'done', 'cancelled', 'no_show'] as const) {
            expect(Object.values(bookingActions(on(THURSDAY, status), TODAY))).not.toContain(true);
        }
    });
});

describe('a cancelled booking on a later day', () => {
    const SCHEDULE = [{ weekday: weekdayOf(THURSDAY), branchId: 'b', opensAt: '10:00', closesAt: '12:00' }];

    const row = (status: AppointmentStatus): Appointment =>
        ({
            id: 'a',
            startsAt: isoAt(THURSDAY, 600),
            durationMinutes: 30,
            status,
            branchId: 'b',
        }) as Appointment;

    const tenOClock = (status: AppointmentStatus) =>
        slotsFor({
            dateKey: THURSDAY,
            schedule: SCHEDULE,
            appointments: [row(status)],
            branchId: 'b',
            durationMinutes: 30,
            nowMinutes: null,
        }).find((slot) => slot.minutes === 600)?.state;

    it('frees its time to be booked again', () => {
        expect(tenOClock('booked')).toBe('taken');
        expect(tenOClock('cancelled')).toBe('free');
    });
});
