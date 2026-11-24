import { afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { clinic, expectAppError, todaySlot } from './helpers/factories.ts';

async function countOf(table: string): Promise<number> {
    const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ${sql(table)}`;
    return Number(row?.n ?? 0);
}

async function snapshot() {
    return {
        patients: await countOf('patients'),
        appointments: await countOf('appointments'),
        reminders: await countOf('reminders'),
        visits: await countOf('visits'),
        visitProcedures: await countOf('visit_procedures'),
    };
}

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('appointment.create', () => {
    test('an overlap rolls back the patient it was about to create', async () => {
        const fixtures = await clinic();
        const startsAt = todaySlot();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt,
            offsetMinutes: 0,
        });

        const before = await snapshot();

        await expectAppError(ERROR_CODE.SLOT_OVERLAP, () =>
            appointmentService.create({
                patient: { kind: 'new', name: 'Walk-up Wael', phone: '01099999999', birthDate: '1990-01-01' },
                branchId: fixtures.branch.id,
                startsAt,
                offsetMinutes: 0,
            }),
        );

        expect(await snapshot()).toEqual(before);
        expect(await patientService.search({ q: 'Wael', limit: 25 })).toEqual([]);
    });

    test('an unknown branch rolls back the patient and the reminder', async () => {
        await clinic();
        const before = await snapshot();

        await expect(
            appointmentService.create({
                patient: {
                    kind: 'new',
                    name: 'Ghost Patient',
                    phone: '01088888888',
                    birthDate: '1990-01-01',
                },
                branchId: Bun.randomUUIDv7(),
                startsAt: todaySlot(),
                offsetMinutes: 0,
            }),
        ).rejects.toThrow();

        expect(await snapshot()).toEqual(before);
    });

    test('an unknown existing patient books nothing', async () => {
        const fixtures = await clinic();
        const before = await snapshot();

        await expectAppError(ERROR_CODE.NOT_FOUND, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: Bun.randomUUIDv7() },
                branchId: fixtures.branch.id,
                startsAt: todaySlot(),
                offsetMinutes: 0,
            }),
        );

        expect(await snapshot()).toEqual(before);
    });

    test('a successful booking writes the appointment and its reminder together', async () => {
        const fixtures = await clinic();
        const before = await snapshot();

        await appointmentService.create({
            patient: { kind: 'new', name: 'New Patient', phone: '01077777777', birthDate: '1990-01-01' },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        const after = await snapshot();
        expect(after.patients).toBe(before.patients + 1);
        expect(after.appointments).toBe(before.appointments + 1);
        expect(after.reminders).toBe(before.reminders + 1);
    });
});

describe('appointment.walkIn', () => {
    afterEach(() => {
        setSystemTime();
    });

    test('a second walk-in queues behind the first rather than being refused', async () => {
        const fixtures = await clinic();
        const first = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            offsetMinutes: 0,
        });

        const before = await snapshot();

        const second = await appointmentService.walkIn({
            patient: { kind: 'new', name: 'Second Walk-up', phone: '01066666666', birthDate: '1990-01-01' },
            branchId: fixtures.branch.id,
            offsetMinutes: 0,
        });

        expect(second.appointment.startsAt.getTime()).toBe(
            first.appointment.startsAt.getTime() + first.appointment.durationMinutes * 60_000,
        );

        const after = await snapshot();
        expect(after.patients).toBe(before.patients + 1);
        expect(after.appointments).toBe(before.appointments + 1);
        expect(after.reminders).toBe(before.reminders + 1);
        expect(after.visits).toBe(before.visits + 1);
        expect(await patientService.search({ q: 'Second', limit: 25 })).toHaveLength(1);
    });

    test.each([
        ['at midday', '2026-03-10T12:00:00.000Z'],
        ['just before midnight', '2026-03-10T23:50:00.000Z'],
    ])('walk-ins taken at the same moment queue instead of refusing each other, %s', async (_when, now) => {
        setSystemTime(new Date(now));
        const fixtures = await clinic();

        const settled = await Promise.allSettled(
            [1, 2, 3, 4].map((n) =>
                appointmentService.walkIn({
                    patient: {
                        kind: 'new',
                        name: `Rush ${n}`,
                        phone: `0107777777${n}`,
                        birthDate: '1990-01-01',
                    },
                    branchId: fixtures.branch.id,
                    offsetMinutes: 0,
                }),
            ),
        );

        const refused = settled.filter((r) => r.status === 'rejected');
        expect(refused.map((r) => String(r.reason))).toEqual([]);

        const rows = await sql<{ starts_at: string; duration_minutes: number }[]>`
            SELECT starts_at, duration_minutes FROM appointments ORDER BY starts_at
        `;
        expect(rows).toHaveLength(4);

        const starts = rows.map((row) => new Date(row.starts_at).getTime());

        expect(new Set(starts).size).toBe(4);

        const gaps = starts.slice(1).map((start, i) => start - (starts[i] ?? 0));
        expect(gaps).toEqual(rows.slice(0, -1).map((row) => row.duration_minutes * 60_000));
    });

    test('a successful walk-in leaves its reminder skipped, not pending', async () => {
        const fixtures = await clinic();

        const { appointment } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            offsetMinutes: 0,
        });

        const [reminder] = await sql<{ status: string }[]>`
            SELECT status FROM reminders WHERE appointment_id = ${appointment.id}
        `;
        expect(reminder?.status).toBe('skipped');
    });

    test('an unknown branch rolls the whole walk-in back', async () => {
        await clinic();
        const before = await snapshot();

        await expect(
            appointmentService.walkIn({
                patient: {
                    kind: 'new',
                    name: 'Doomed Walk-up',
                    phone: '01055555555',
                    birthDate: '1990-01-01',
                },
                branchId: Bun.randomUUIDv7(),
                offsetMinutes: 0,
            }),
        ).rejects.toThrow();

        expect(await snapshot()).toEqual(before);
    });
});

describe('visit.checkIn', () => {
    test('a refused check-in creates no visit and leaves the appointment booked', async () => {
        const fixtures = await clinic();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        await appointmentService.cancel(appointment.id);

        const before = await snapshot();

        await expectAppError(ERROR_CODE.INVALID_STATUS_TRANSITION, () =>
            visitService.checkIn({ appointmentId: appointment.id }),
        );

        expect(await snapshot()).toEqual(before);
        expect((await appointmentService.byId(appointment.id)).status).toBe('cancelled');
    });

    test('check-in writes the visit and the status together, and adds no checkup line', async () => {
        const fixtures = await clinic();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });

        const before = await snapshot();
        await visitService.checkIn({ appointmentId: appointment.id });
        const after = await snapshot();

        expect(after.visits).toBe(before.visits + 1);
        expect(after.visitProcedures).toBe(before.visitProcedures);
        expect((await appointmentService.byId(appointment.id)).status).toBe('checked_in');
    });

    test('an unknown appointment creates nothing', async () => {
        await clinic();
        const before = await snapshot();

        await expectAppError(ERROR_CODE.NOT_FOUND, () =>
            visitService.checkIn({ appointmentId: Bun.randomUUIDv7() }),
        );

        expect(await snapshot()).toEqual(before);
    });
});

describe('visit.setProcedures', () => {
    test('a rejected line leaves the existing lines untouched', async () => {
        const fixtures = await clinic();
        const appointment = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        const visit = await visitService.checkIn({ appointmentId: appointment.id });

        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [{ procedureId: fixtures.rootCanal.id, quantity: 1 }],
        });
        const before = await visitService.byId(visit.id);

        await expectAppError(ERROR_CODE.PROCEDURE_DUPLICATE, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [
                    { procedureId: fixtures.xray.id, quantity: 2 },
                    { procedureId: fixtures.rootCanal.id, quantity: 1 },
                    { procedureId: fixtures.rootCanal.id, quantity: 1 },
                ],
            }),
        );

        const after = await visitService.byId(visit.id);
        expect(after.procedures.map((p) => p.procedureId)).toEqual(
            before.procedures.map((p) => p.procedureId),
        );
        expect(after.computedTotal).toBe(before.computedTotal);
    });
});
