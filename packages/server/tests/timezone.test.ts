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

const CAIRO = 180;

const LOCAL_DAY = '2026-09-15';

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

        expect(day.length).toBe(2);
        expect(day.map((a) => a.startsAt.toISOString()).sort()).toEqual([afterMidnight, lateEvening].sort());
    });

    test('the same appointments split across two days when read as UTC', async () => {
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
        const fixtures = await clinic();

        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: localTime('00:30'),
            offsetMinutes: CAIRO,
        });

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
    async function completedVisit(chargedTotal: number, paidTotal: number) {
        const fixtures = await clinic();
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

describe('the night the clocks go back', () => {
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
