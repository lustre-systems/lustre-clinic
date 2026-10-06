import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { clinicOffsetNow, offsetForDate } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { balanceService } from '../src/modules/balance/balance.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { statsService } from '../src/modules/stats/stats.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { clinic } from './helpers/factories.ts';

/**
 * SPEC §5, §7, §11 — "the clinic's today".
 *
 * Every timestamp is `timestamptz`, so the server holds instants and a calendar
 * day only exists relative to somebody. The client sends its UTC offset and the
 * server never guesses. `util.test.ts` proves `dayRange` does the arithmetic;
 * what is untested is whether the offset actually reaches it — every other
 * integration test passes `offsetMinutes: 0`, which is exactly the value that
 * cannot tell a working pipeline from a dropped argument.
 *
 * Cairo runs UTC+2, UTC+3 over summer. `CAIRO` is the summer offset, which is
 * the interesting one: it pushes the start of the local day back to 21:00 the
 * previous evening, so late-evening appointments change day.
 */

/** Africa/Cairo in summer. */
const CAIRO = 180;

/** A fixed local day, well away from "now", so nothing depends on the clock. */
const LOCAL_DAY = '2026-09-15';

/** `HH:MM` on `LOCAL_DAY` as the clinic reads it, expressed as a UTC instant. */
function localTime(hhmm: string, offsetMinutes = CAIRO): string {
    const [hours = '0', minutes = '0'] = hhmm.split(':');
    const asIfUtc = Date.parse(`${LOCAL_DAY}T${hours.padStart(2, '0')}:${minutes}:00Z`);
    return new Date(asIfUtc - offsetMinutes * 60_000).toISOString();
}

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('appointment.byDate', () => {
    test('a late-evening appointment belongs to the clinic day, not the UTC day', async () => {
        // 22:00 in Cairo is 19:00 UTC — same day either way, so this one is the
        // control. 00:30 Cairo is 21:30 UTC *the previous day*: it is the one
        // that moves, and the one a dropped offset gets wrong.
        const fixtures = await clinic();
        const lateEvening = localTime('22:00');
        const afterMidnight = localTime('00:30');

        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: lateEvening,
            offsetMinutes: CAIRO,
        });
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: afterMidnight,
            offsetMinutes: CAIRO,
        });

        expect(afterMidnight.slice(0, 10)).not.toBe(LOCAL_DAY);

        const day = await appointmentService.byDate({
            date: LOCAL_DAY,
            branchId: fixtures.branch.id,
            offsetMinutes: CAIRO,
        });

        // Both are on the clinic's 15th, even though one is on UTC's 14th.
        expect(day.length).toBe(2);
        expect(day.map((a) => a.startsAt.toISOString()).sort()).toEqual([afterMidnight, lateEvening].sort());
    });

    test('the same appointments split across two days when read as UTC', async () => {
        // The counter-assertion: with the offset dropped, the 00:30 booking
        // falls on the previous day. This is what a regression looks like.
        const fixtures = await clinic();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('00:30'),
            offsetMinutes: CAIRO,
        });

        const asCairo = await appointmentService.byDate({ date: LOCAL_DAY, offsetMinutes: CAIRO });
        const asUtc = await appointmentService.byDate({ date: LOCAL_DAY, offsetMinutes: 0 });

        expect(asCairo.length).toBe(1);
        expect(asUtc.length).toBe(0);
    });

    test('a booking at the first minute of the clinic day is included', async () => {
        const fixtures = await clinic();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('00:00'),
            offsetMinutes: CAIRO,
        });

        const day = await appointmentService.byDate({ date: LOCAL_DAY, offsetMinutes: CAIRO });
        expect(day.length).toBe(1);
    });

    test('the day is half-open — midnight belongs to the day it starts', async () => {
        const fixtures = await clinic();
        // 00:00 on the 16th, Cairo. Must not appear on the 15th.
        const nextMidnight = new Date(Date.parse(localTime('00:00')) + 86_400_000).toISOString();

        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: nextMidnight,
            offsetMinutes: CAIRO,
        });

        expect((await appointmentService.byDate({ date: LOCAL_DAY, offsetMinutes: CAIRO })).length).toBe(0);
        expect((await appointmentService.byDate({ date: '2026-09-16', offsetMinutes: CAIRO })).length).toBe(
            1,
        );
    });

    test('a negative offset works the same way', async () => {
        // New York, UTC-4 in summer. 20:00 local is 00:00 UTC the next day.
        const newYork = -240;
        const fixtures = await clinic();
        const evening = localTime('20:00', newYork);

        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: evening,
            offsetMinutes: newYork,
        });

        expect(evening.slice(0, 10)).toBe('2026-09-16');
        expect((await appointmentService.byDate({ date: LOCAL_DAY, offsetMinutes: newYork })).length).toBe(1);
    });
});

describe('ref', () => {
    test('carries the clinic-local date, not the UTC one', async () => {
        // A 00:30 Cairo booking is 21:30 UTC on the 14th. The ref is read down
        // the phone against the appointment card, so it has to say the 15th.
        const fixtures = await clinic();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('00:30'),
            offsetMinutes: CAIRO,
        });

        // DDMMYY, day first (§5).
        expect(appointment.ref.startsWith('150926-')).toBe(true);
    });

    test('the same instant booked as UTC carries the previous day', async () => {
        const fixtures = await clinic();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('00:30'),
            offsetMinutes: 0,
        });

        expect(appointment.ref.startsWith('140926-')).toBe(true);
    });
});

describe('reminder.pending', () => {
    test('renders the clinic-local date and time into the message', async () => {
        // §11 — the message tells a patient when to turn up. `starts_at` is
        // UTC, so rendering it raw quotes an hour that is two or three off.
        const fixtures = await clinic();
        await settingsService.update({
            reminderTemplate: 'Reminder: {{date}} at {{time}}',
        });
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('09:30'),
            offsetMinutes: CAIRO,
        });

        const [reminder] = await reminderService.pending({
            dueOnly: false,
            limit: 100,
            offsetMinutes: CAIRO,
        });

        expect(reminder?.message).toBe(`Reminder: ${LOCAL_DAY} at 09:30`);
    });

    test('a booking after local midnight quotes the local date', async () => {
        const fixtures = await clinic();
        await settingsService.update({ reminderTemplate: '{{date}} {{time}}' });
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('00:30'),
            offsetMinutes: CAIRO,
        });

        const [reminder] = await reminderService.pending({
            dueOnly: false,
            limit: 100,
            offsetMinutes: CAIRO,
        });

        // UTC would say 2026-09-14 21:30 — the wrong day and the wrong hour.
        expect(reminder?.message).toBe(`${LOCAL_DAY} 00:30`);
    });

    test('the whatsapp link carries the same rendered message', async () => {
        const fixtures = await clinic();
        await settingsService.update({ reminderTemplate: '{{time}}' });
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('14:45'),
            offsetMinutes: CAIRO,
        });

        const [reminder] = await reminderService.pending({
            dueOnly: false,
            limit: 100,
            offsetMinutes: CAIRO,
        });

        expect(reminder?.message).toBe('14:45');
        expect(reminder?.whatsAppUrl).toContain(encodeURIComponent('14:45'));
    });
});

describe('period summaries', () => {
    /** A visit completed now, so it lands in whatever period covers today. */
    async function completedVisit(chargedTotal: number, paidTotal: number) {
        const fixtures = await clinic();
        // With a line on it, because checkout refuses a visit with none.
        const { visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            offsetMinutes: 0,
            procedures: [{ procedureId: fixtures.rootCanal.id, quantity: 1 }],
        });
        await visitService.checkOut({ visitId, chargedTotal, paidTotal, method: 'cash' });
        return fixtures;
    }

    test('balance.summary counts a visit once, whatever the offset', async () => {
        await completedVisit(100_000, 40_000);

        // The period is wide enough that the visit falls inside it at any
        // offset; what is asserted is that shifting the window does not double
        // count it or drop it.
        const range = { from: '2020-01-01', to: '2035-01-01' };

        for (const offsetMinutes of [0, CAIRO, -240]) {
            const summary = await balanceService.summary({ ...range, offsetMinutes });
            expect(summary.charged).toBe(100_000);
            expect(summary.collected).toBe(40_000);
            expect(summary.difference).toBe(60_000);
        }
    });

    test('stats.summary counts the appointment once, whatever the offset', async () => {
        await completedVisit(100_000, 100_000);
        const range = { from: '2020-01-01', to: '2035-01-01' };

        for (const offsetMinutes of [0, CAIRO, -240]) {
            const summary = await statsService.summary({ ...range, offsetMinutes });
            expect(summary.appointments.total).toBe(1);
            expect(summary.appointments.completed).toBe(1);
            expect(summary.visits.charged).toBe(100_000);
        }
    });

    test('a period that ended before the visit excludes it', async () => {
        await completedVisit(100_000, 40_000);

        const summary = await balanceService.summary({
            from: '2020-01-01',
            to: '2020-01-02',
            offsetMinutes: CAIRO,
        });

        expect(summary.charged).toBe(0);
        expect(summary.collected).toBe(0);
    });
});

describe('appointment.missed', () => {
    test('is offset-independent — it compares instants, not calendar days', async () => {
        // §7 — missed is `starts_at + duration < now()`, evaluated in SQL. It
        // takes no offset and must not acquire one: an appointment that has
        // already ended has ended everywhere.
        const fixtures = await clinic();
        const past = new Date(Date.now() - 3 * 3_600_000).toISOString();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: past,
            offsetMinutes: CAIRO,
        });

        const missed = await appointmentService.missed({ limit: 100 });
        expect(missed.map((a) => a.id)).toContain(appointment.id);
    });

    test('an appointment still in progress is not missed', async () => {
        const fixtures = await clinic();
        // Started 10 minutes ago, runs 45 — still in the chair.
        const justStarted = new Date(Date.now() - 10 * 60_000).toISOString();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: justStarted,
            durationMinutes: 45,
            offsetMinutes: CAIRO,
        });

        const missed = await appointmentService.missed({ limit: 100 });
        expect(missed.map((a) => a.id)).not.toContain(appointment.id);
    });
});

/**
 * 29 October 2026: Cairo's summer time ends at midnight, 24:00 at +3 becoming
 * 23:00 at +2, so the clinic's Thursday runs 25 hours. The app sends the offset
 * that starts the day (`offsetForDate`), and the server gives a caller on
 * clinic time the whole of it.
 */
describe('the night the clocks go back', () => {
    // 23:30 the second time round, at +2.
    const lateThursday = '2026-10-29T21:30:00.000Z';

    test('a late appointment stays on its own day', async () => {
        const fixtures = await clinic();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: lateThursday,
            offsetMinutes: offsetForDate('2026-10-29'),
        });

        const thursday = await appointmentService.byDate({
            date: '2026-10-29',
            offsetMinutes: offsetForDate('2026-10-29'),
        });
        const friday = await appointmentService.byDate({
            date: '2026-10-30',
            offsetMinutes: offsetForDate('2026-10-30'),
        });

        expect(thursday.map((row) => row.startsAt.toISOString())).toEqual([lateThursday]);
        expect(friday).toEqual([]);
        expect(thursday[0]?.ref).toStartWith('291026-');
    });

    test("a reminder quotes the clinic's time on the far side of the change", async () => {
        const fixtures = await clinic();
        await settingsService.update({ reminderTemplate: '{{date}} {{time}}' });
        // 17:30 in Cairo on 2 November, at +2.
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: '2026-11-02T15:30:00.000Z',
            offsetMinutes: offsetForDate('2026-11-02'),
        });

        const [reminder] = await reminderService.pending({
            dueOnly: false,
            limit: 100,
            offsetMinutes: clinicOffsetNow(),
        });

        expect(reminder?.message).toBe('2026-11-02 17:30');
    });
});
