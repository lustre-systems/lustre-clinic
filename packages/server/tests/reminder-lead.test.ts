import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { reminders } from '../src/db/schema.ts';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { bookedAppointment, clinic, expectAppError, slot } from './helpers/factories.ts';

const HOUR = 3_600_000;

async function reminderFor(appointmentId: string) {
    const [row] = await db.select().from(reminders).where(eq(reminders.appointmentId, appointmentId));
    if (!row) throw new Error('expected a reminder');
    return row;
}

async function dueAtOf(appointmentId: string): Promise<number> {
    return (await reminderFor(appointmentId)).dueAt.getTime();
}

async function backendsWaitingOnALock(): Promise<number> {
    const [row] = await sql<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    return row?.waiting ?? 0;
}

async function queuedOnTheSettingsRow<T>(contenders: Array<() => Promise<T>>): Promise<T[]> {
    let held!: () => void;
    let release!: () => void;
    const isHeld = new Promise<void>((resolve) => {
        held = resolve;
    });
    const letGo = new Promise<void>((resolve) => {
        release = resolve;
    });

    const holder = sql.begin(async (tx) => {
        await tx`SELECT id FROM settings WHERE id = 1 FOR UPDATE`;
        held();
        await letGo;
    });
    await isHeld;

    const running: Promise<T>[] = [];
    for (const [index, start] of contenders.entries()) {
        running.push(start());
        for (let tries = 0; (await backendsWaitingOnALock()) < index + 1; tries++) {
            if (tries > 200) throw new Error(`contender ${index} never queued on the settings row`);
            await Bun.sleep(10);
        }
    }

    release();
    await holder;
    return Promise.all(running);
}

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('changing the reminder lead time', () => {
    test('moves a reminder that was already booked', async () => {
        const { appointment } = await bookedAppointment();

        await settingsService.update({ reminderLeadHours: 6 });

        expect(await dueAtOf(appointment.id)).toBe(appointment.startsAt.getTime() - 6 * HOUR);
    });

    test('moves every pending reminder, not only the next one', async () => {
        const fixtures = await clinic();
        const booked = [];
        for (const offset of [0, 60, 120]) {
            booked.push(
                await appointmentService.create({
                    patient: { kind: 'existing', patientId: fixtures.patient.id },
                    branchId: fixtures.branch.id,
                    startsAt: slot(offset),
                    offsetMinutes: 0,
                }),
            );
        }

        await settingsService.update({ reminderLeadHours: 3 });

        for (const appointment of booked) {
            expect(await dueAtOf(appointment.id)).toBe(appointment.startsAt.getTime() - 3 * HOUR);
        }
    });

    test('the pending list reads back at the new lead, not the old one', async () => {
        const { appointment } = await bookedAppointment();
        const hoursAway = Math.ceil((appointment.startsAt.getTime() - Date.now()) / HOUR);

        await settingsService.update({ reminderLeadHours: 1 });
        expect(await reminderService.pending({ dueOnly: true, limit: 100, offsetMinutes: 0 })).toEqual([]);

        await settingsService.update({ reminderLeadHours: hoursAway + 1 });
        const due = await reminderService.pending({ dueOnly: true, limit: 100, offsetMinutes: 0 });
        expect(due.map((row) => row.appointmentId)).toEqual([appointment.id]);
    });

    test('takes the setting with it, so a later booking agrees with the moved ones', async () => {
        const { appointment, ...fixtures } = await bookedAppointment();

        await settingsService.update({ reminderLeadHours: 5 });
        const later = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: slot(90),
            offsetMinutes: 0,
        });

        expect((await settingsService.get()).reminderLeadHours).toBe(5);
        expect(await dueAtOf(appointment.id)).toBe(appointment.startsAt.getTime() - 5 * HOUR);
        expect(await dueAtOf(later.id)).toBe(later.startsAt.getTime() - 5 * HOUR);
    });
});

describe('what a new lead time leaves alone', () => {
    test('a reminder already marked sent', async () => {
        const { appointment } = await bookedAppointment();
        const before = await reminderFor(appointment.id);
        await reminderService.markSent(before.id);

        await settingsService.update({ reminderLeadHours: 2 });

        expect(await dueAtOf(appointment.id)).toBe(before.dueAt.getTime());
    });

    test('a reminder skipped by hand', async () => {
        const { appointment } = await bookedAppointment();
        const before = await reminderFor(appointment.id);
        await reminderService.markSkipped(before.id);

        await settingsService.update({ reminderLeadHours: 2 });

        expect(await dueAtOf(appointment.id)).toBe(before.dueAt.getTime());
    });

    test('a cancelled appointment', async () => {
        const { appointment } = await bookedAppointment();
        const before = await dueAtOf(appointment.id);
        await appointmentService.cancel(appointment.id);

        await settingsService.update({ reminderLeadHours: 2 });

        expect(await dueAtOf(appointment.id)).toBe(before);
    });

    test('an appointment that has already been and gone', async () => {
        const { appointment } = await bookedAppointment();
        await sql`UPDATE appointments SET starts_at = now() - interval '2 hours' WHERE id = ${appointment.id}`;
        const before = await dueAtOf(appointment.id);

        await settingsService.update({ reminderLeadHours: 2 });

        expect(await dueAtOf(appointment.id)).toBe(before);
    });

    test('every reminder, when the lead time is saved unchanged', async () => {
        const { appointment } = await bookedAppointment();
        const { reminderLeadHours } = await settingsService.get();
        await sql`UPDATE reminders SET due_at = now() WHERE appointment_id = ${appointment.id}`;
        const untouched = await dueAtOf(appointment.id);

        await settingsService.update({ reminderLeadHours });

        expect(await dueAtOf(appointment.id)).toBe(untouched);
    });

    test('every reminder, when some other setting is the one being saved', async () => {
        const { appointment } = await bookedAppointment();
        await sql`UPDATE reminders SET due_at = now() WHERE appointment_id = ${appointment.id}`;
        const untouched = await dueAtOf(appointment.id);

        await settingsService.update({ reminderTemplate: 'See you {{date}}.', reminderRepeatMinutes: 30 });

        expect(await dueAtOf(appointment.id)).toBe(untouched);
    });
});

describe('a booking taken while the lead time is changing', () => {
    async function raceABooking(first: 'booking' | 'settings') {
        const fixtures = await clinic();
        const startsAt = slot(first === 'booking' ? 0 : 30);

        const booking = () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: fixtures.patient.id },
                branchId: fixtures.branch.id,
                startsAt,
                offsetMinutes: 0,
            });
        const change = () => settingsService.update({ reminderLeadHours: 9 });

        const [appointment] =
            first === 'booking'
                ? await Promise.all([booking(), change()])
                : await Promise.all([change(), booking()]).then(([, a]) => [a] as const);

        return { appointment, dueAt: await dueAtOf(appointment.id) };
    }

    test('lands on the new lead time when the booking goes first', async () => {
        const { appointment, dueAt } = await raceABooking('booking');
        expect(dueAt).toBe(appointment.startsAt.getTime() - 9 * HOUR);
    });

    test('lands on the new lead time when the change goes first', async () => {
        const { appointment, dueAt } = await raceABooking('settings');
        expect(dueAt).toBe(appointment.startsAt.getTime() - 9 * HOUR);
    });

    test('registers a patient and books without deadlocking on the settings row', async () => {
        const fixtures = await clinic();

        const booked = await Promise.all(
            [0, 30, 60].map((offset) =>
                appointmentService.create({
                    patient: {
                        kind: 'new',
                        name: `Walk In ${offset}`,
                        phone: '01099988877',
                        birthDate: '1990-01-01',
                    },
                    branchId: fixtures.branch.id,
                    startsAt: slot(offset),
                    offsetMinutes: 0,
                }),
            ),
        );

        const { reminderLeadHours } = await settingsService.get();
        for (const appointment of booked) {
            expect(await dueAtOf(appointment.id)).toBe(
                appointment.startsAt.getTime() - reminderLeadHours * HOUR,
            );
        }
    });
});

describe('two saves of the lead time at once', () => {
    test('leave the setting and the reminders agreeing', async () => {
        const { appointment } = await bookedAppointment();
        const { reminderLeadHours: before } = await settingsService.get();

        await queuedOnTheSettingsRow([
            () => settingsService.update({ reminderLeadHours: 9 }),
            () => settingsService.update({ reminderLeadHours: before }),
        ]);

        const { reminderLeadHours: after } = await settingsService.get();
        expect(after).toBe(before);
        expect(await dueAtOf(appointment.id)).toBe(appointment.startsAt.getTime() - after * HOUR);
    });

    test('agree when the counter is saved beside the one that goes first', async () => {
        const { appointment, patient } = await bookedAppointment();
        await sql`UPDATE patients SET ref = '30' WHERE id = ${patient.id}`;
        const { reminderLeadHours: before } = await settingsService.get();

        await queuedOnTheSettingsRow([
            () => settingsService.update({ reminderLeadHours: 11, patientRefNext: 60 }),
            () => settingsService.update({ reminderLeadHours: before }),
        ]);

        const { reminderLeadHours: after } = await settingsService.get();
        expect(after).toBe(before);
        expect(await dueAtOf(appointment.id)).toBe(appointment.startsAt.getTime() - after * HOUR);
    });
});

describe('a refused settings update', () => {
    test('leaves both the lead time and the reminders where they were', async () => {
        const { appointment } = await bookedAppointment();
        const before = await settingsService.get();
        const dueAt = await dueAtOf(appointment.id);

        await expectAppError(ERROR_CODE.INVALID_DURATION, () =>
            settingsService.update({ reminderLeadHours: 2, durationOptions: [30], defaultDuration: 45 }),
        );

        expect((await settingsService.get()).reminderLeadHours).toBe(before.reminderLeadHours);
        expect(await dueAtOf(appointment.id)).toBe(dueAt);
    });

    test('rolls the reminders back when the patient counter is the thing refused', async () => {
        const { appointment, patient } = await bookedAppointment();
        await sql`UPDATE patients SET ref = '9000' WHERE id = ${patient.id}`;
        const before = await settingsService.get();
        const dueAt = await dueAtOf(appointment.id);

        await expectAppError(ERROR_CODE.PATIENT_REF_BELOW_EXISTING, () =>
            settingsService.update({ reminderLeadHours: 2, patientRefNext: 10 }),
        );

        expect((await settingsService.get()).reminderLeadHours).toBe(before.reminderLeadHours);
        expect(await dueAtOf(appointment.id)).toBe(dueAt);
    });

    test('moves the reminders when the patient counter is saved alongside and accepted', async () => {
        const { appointment, patient } = await bookedAppointment();
        await sql`UPDATE patients SET ref = '40' WHERE id = ${patient.id}`;

        await settingsService.update({ reminderLeadHours: 7, patientRefNext: 80 });

        const after = await settingsService.get();
        expect(after.reminderLeadHours).toBe(7);
        expect(after.patientRefNext).toBe(80);
        expect(await dueAtOf(appointment.id)).toBe(appointment.startsAt.getTime() - 7 * HOUR);
    });
});
