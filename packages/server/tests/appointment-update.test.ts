import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { APPOINTMENT_TRANSITIONS, type AppointmentStatus, ERROR_CODE } from '@lustre/shared';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { reminders } from '../src/db/schema.ts';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { bookedAppointment, clinic, expectAppError, slot, todaySlot } from './helpers/factories.ts';

async function reminderFor(appointmentId: string) {
    const [row] = await db.select().from(reminders).where(eq(reminders.appointmentId, appointmentId));
    return row;
}

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('rescheduling', () => {
    test('moves the appointment and reports the new time', async () => {
        const { appointment } = await bookedAppointment();
        const moved = new Date(Date.parse(slot()) + 3_600_000).toISOString();

        const updated = await appointmentService.update({ id: appointment.id, startsAt: moved });

        expect(updated.startsAt.toISOString()).toBe(moved);
    });

    test('reports a collision as SLOT_OVERLAP rather than a database error', async () => {
        const fixtures = await clinic();
        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });
        const second = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: new Date(Date.parse(slot()) + 3_600_000).toISOString(),
            offsetMinutes: 0,
        });

        await expectAppError(ERROR_CODE.SLOT_OVERLAP, () =>
            appointmentService.update({ id: second.id, startsAt: first.startsAt.toISOString() }),
        );
    });

    test('a refused reschedule leaves the appointment where it was', async () => {
        const fixtures = await clinic();
        const startsAt = slot();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt,
            offsetMinutes: 0,
        });
        const movingAt = new Date(Date.parse(startsAt) + 3_600_000).toISOString();
        const second = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: movingAt,
            offsetMinutes: 0,
        });

        await expectAppError(ERROR_CODE.SLOT_OVERLAP, () =>
            appointmentService.update({ id: second.id, startsAt }),
        );

        const after = await appointmentService.byId(second.id);
        expect(after.startsAt.toISOString()).toBe(movingAt);
    });

    test('the reminder follows the appointment', async () => {
        const { appointment } = await bookedAppointment();
        const { reminderLeadHours } = await settingsService.get();
        const moved = new Date(Date.parse(slot()) + 5 * 3_600_000).toISOString();

        await appointmentService.update({ id: appointment.id, startsAt: moved });

        const reminder = await reminderFor(appointment.id);
        expect(reminder?.dueAt.toISOString()).toBe(
            new Date(Date.parse(moved) - reminderLeadHours * 3_600_000).toISOString(),
        );
    });

    test('extending a duration into the next appointment is refused', async () => {
        const fixtures = await clinic();
        const startsAt = slot();
        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt,
            durationMinutes: 20,
            offsetMinutes: 0,
        });
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: new Date(Date.parse(startsAt) + 20 * 60_000).toISOString(),
            durationMinutes: 20,
            offsetMinutes: 0,
        });

        await expectAppError(ERROR_CODE.SLOT_OVERLAP, () =>
            appointmentService.update({ id: first.id, durationMinutes: 45 }),
        );
    });

    test('refuses a duration the clinic has not configured', async () => {
        const { appointment } = await bookedAppointment();

        await expectAppError(ERROR_CODE.INVALID_DURATION, () =>
            appointmentService.update({ id: appointment.id, durationMinutes: 37 }),
        );
    });

    test('keeps the original ref, so the number the patient was given still works', async () => {
        const { appointment } = await bookedAppointment();
        const moved = new Date(Date.parse(slot()) + 48 * 3_600_000).toISOString();

        const updated = await appointmentService.update({ id: appointment.id, startsAt: moved });

        expect(updated.ref).toBe(appointment.ref);
    });

    test('rejects an unknown appointment', async () => {
        await expectAppError(ERROR_CODE.NOT_FOUND, () =>
            appointmentService.update({ id: Bun.randomUUIDv7(), note: 'nobody' }),
        );
    });
});

describe('status transitions', () => {
    test('marking no_show skips the reminder', async () => {
        const { appointment } = await bookedAppointment();

        await appointmentService.update({ id: appointment.id, status: 'no_show' });

        expect((await reminderFor(appointment.id))?.status).toBe('skipped');
        const pending = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
        expect(pending.map((r) => r.appointmentId)).not.toContain(appointment.id);
    });

    test('a no_show frees the slot', async () => {
        const fixtures = await clinic();
        const startsAt = slot();
        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt,
            offsetMinutes: 0,
        });

        await appointmentService.update({ id: first.id, status: 'no_show' });

        const rebooked = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt,
            offsetMinutes: 0,
        });
        expect(rebooked.id).not.toBe(first.id);
    });

    test('refuses no_show on an appointment that is already resolved', async () => {
        const { appointment } = await bookedAppointment();
        await appointmentService.cancel(appointment.id);

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.update({ id: appointment.id, status: 'no_show' }),
        );
    });

    test('refuses no_show on a checked-in appointment', async () => {
        const { appointment } = await bookedAppointment(todaySlot());
        await visitService.checkIn({ appointmentId: appointment.id });

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.update({ id: appointment.id, status: 'no_show' }),
        );
    });

    test('refuses to move an appointment that is no longer booked, and leaves it where it was', async () => {
        const { appointment } = await bookedAppointment(todaySlot());
        await visitService.checkIn({ appointmentId: appointment.id });
        const moved = new Date(appointment.startsAt.getTime() + 24 * 3_600_000).toISOString();

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            appointmentService.update({ id: appointment.id, startsAt: moved }),
        );

        const current = await appointmentService.byId(appointment.id);
        expect(current.startsAt.toISOString()).toBe(appointment.startsAt.toISOString());
        expect(current.status).toBe('checked_in');
    });

    test('the transition table permits exactly what §7 draws', () => {
        expect(APPOINTMENT_TRANSITIONS).toEqual({
            booked: ['checked_in', 'cancelled', 'no_show'],
            checked_in: ['awaiting_payment', 'done'],
            awaiting_payment: ['done'],
            done: [],
            cancelled: [],
            no_show: [],
        });
    });

    test('no terminal status transitions anywhere', () => {
        const terminal: AppointmentStatus[] = ['done', 'cancelled', 'no_show'];
        for (const status of terminal) {
            expect(APPOINTMENT_TRANSITIONS[status]).toEqual([]);
        }
    });
});

describe('reminder.markSkipped', () => {
    test('takes a reminder off the pending list without marking it sent', async () => {
        await bookedAppointment();
        const [reminder] = await reminderService.pending({
            dueOnly: false,
            limit: 100,
            offsetMinutes: 0,
        });
        if (!reminder) throw new Error('expected a pending reminder');

        const skipped = await reminderService.markSkipped(reminder.id);

        expect(skipped.status).toBe('skipped');
        expect(skipped.sentAt).toBeNull();
        expect((await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 })).length).toBe(
            0,
        );
    });

    test('rejects an unknown reminder', async () => {
        await expectAppError(ERROR_CODE.NOT_FOUND, () => reminderService.markSkipped(Bun.randomUUIDv7()));
    });
});
