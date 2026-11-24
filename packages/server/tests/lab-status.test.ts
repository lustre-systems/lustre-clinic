import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { WS_EVENT } from '@lustre/shared';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { appointments } from '../src/db/schema.ts';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { bookedAppointment, clinic, slot } from './helpers/factories.ts';
import { captureWsEvents, startTestServer, type TestServer } from './helpers/trpc.ts';

let api: TestServer;

beforeAll(async () => {
    await setupDatabase();
    api = startTestServer();
});

beforeEach(async () => {
    await truncateAll();
});

afterAll(() => {
    api.stop();
});

async function labStatusOf(id: string) {
    const [row] = await db
        .select({ labStatus: appointments.labStatus })
        .from(appointments)
        .where(eq(appointments.id, id));
    return row?.labStatus;
}

async function pendingReminders() {
    return reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
}

describe('the migration', () => {
    test('adds a nullable lab_status that defaults to no lab', async () => {
        const [column] = await sql<{ nullable: string; fallback: string | null }[]>`
            SELECT is_nullable AS nullable, column_default AS fallback
            FROM information_schema.columns
            WHERE table_name = 'appointments' AND column_name = 'lab_status'
        `;
        expect(column).toEqual({ nullable: 'YES', fallback: null });
    });

    test('refuses a lab status that is not pending or ready', async () => {
        const { appointment } = await bookedAppointment();

        const refused = await db
            .execute(drizzleSql`UPDATE appointments SET lab_status = 'sent' WHERE id = ${appointment.id}`)
            .then(
                () => null,
                (err: unknown) => err,
            );

        expect(String((refused as { cause?: unknown })?.cause ?? refused)).toContain(
            'appointments_lab_status_valid',
        );
    });
});

describe('booking', () => {
    test('without the switch, the appointment needs no lab', async () => {
        const { appointment } = await bookedAppointment();

        expect(appointment.labStatus).toBeNull();
        expect((await appointmentService.byId(appointment.id)).labStatus).toBeNull();
    });

    test('with the switch, the lab is pending', async () => {
        const fixtures = await clinic();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: slot(),
            needsLab: true,
            offsetMinutes: 0,
        });

        expect(appointment.labStatus).toBe('pending');
        const [onTheDay] = await appointmentService.byDate({
            date: slot().slice(0, 10),
            offsetMinutes: 0,
        });
        expect(onTheDay?.labStatus).toBe('pending');
    });

    test('a walk-in can carry lab work too', async () => {
        const fixtures = await clinic();
        const { appointment } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            needsLab: true,
            offsetMinutes: 0,
        });

        expect(appointment.labStatus).toBe('pending');
    });
});

describe('update', () => {
    test('switches the requirement on and off', async () => {
        const { appointment } = await bookedAppointment();

        expect((await appointmentService.update({ id: appointment.id, needsLab: true })).labStatus).toBe(
            'pending',
        );
        expect(
            (await appointmentService.update({ id: appointment.id, needsLab: false })).labStatus,
        ).toBeNull();
    });

    test('switching it on again keeps work that is already back', async () => {
        const { appointment } = await bookedAppointment();
        await appointmentService.update({ id: appointment.id, needsLab: true });
        await appointmentService.markLabReady(appointment.id);

        await appointmentService.update({ id: appointment.id, needsLab: true });

        expect(await labStatusOf(appointment.id)).toBe('ready');
    });

    test('an edit that does not mention the lab leaves it alone', async () => {
        const { appointment } = await bookedAppointment();
        await appointmentService.update({ id: appointment.id, needsLab: true });

        await appointmentService.update({ id: appointment.id, note: 'bring the old x-ray' });
        await appointmentService.update({
            id: appointment.id,
            startsAt: new Date(Date.parse(slot()) + 3_600_000).toISOString(),
        });

        expect(await labStatusOf(appointment.id)).toBe('pending');
    });
});

describe('marking the lab ready', () => {
    test('moves pending to ready and tells every phone', async () => {
        const { appointment } = await bookedAppointment();
        await appointmentService.update({ id: appointment.id, needsLab: true });

        const { result, events } = await captureWsEvents(api.wsUrl, () =>
            api.client.appointment.markLabReady.mutate({ id: appointment.id }),
        );

        expect(result.labStatus).toBe('ready');
        expect(events).toEqual([{ event: WS_EVENT.APPOINTMENT_UPDATED, id: appointment.id }]);
    });

    test('is a quiet no-op when nothing is pending', async () => {
        const { appointment } = await bookedAppointment();

        const { result, events } = await captureWsEvents(api.wsUrl, () =>
            api.client.appointment.markLabReady.mutate({ id: appointment.id }),
        );

        expect(result.labStatus).toBeNull();
        expect(events).toEqual([]);
    });

    test('a second tap changes nothing', async () => {
        const { appointment } = await bookedAppointment();
        await appointmentService.update({ id: appointment.id, needsLab: true });
        await appointmentService.markLabReady(appointment.id);

        const { events } = await captureWsEvents(api.wsUrl, () =>
            api.client.appointment.markLabReady.mutate({ id: appointment.id }),
        );

        expect(await labStatusOf(appointment.id)).toBe('ready');
        expect(events).toEqual([]);
    });
});

describe('reminders', () => {
    test('carry the lab status of their appointment', async () => {
        const { appointment } = await bookedAppointment();
        const [before] = await pendingReminders();
        expect(before?.labStatus).toBeNull();

        await appointmentService.update({ id: appointment.id, needsLab: true });
        const [waiting] = await pendingReminders();
        expect(waiting?.labStatus).toBe('pending');

        await appointmentService.markLabReady(appointment.id);
        const [back] = await pendingReminders();
        expect(back?.labStatus).toBe('ready');
    });

    test('a pending lab does not hold the reminder back', async () => {
        const { appointment } = await bookedAppointment();
        await appointmentService.update({ id: appointment.id, needsLab: true });
        const [reminder] = await pendingReminders();
        if (!reminder) throw new Error('expected a reminder');

        await reminderService.markSent(reminder.id);

        expect(await pendingReminders()).toEqual([]);
        expect(await labStatusOf(appointment.id)).toBe('pending');
    });
});
