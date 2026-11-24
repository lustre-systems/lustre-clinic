import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { visits } from '../src/db/schema.ts';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { bookedAppointment, type Clinic, clinic, todaySlot } from './helpers/factories.ts';

let closeDatabase: (() => Promise<void>) | undefined;

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await closeDatabase?.();
});

async function seatStamp(visitId: string): Promise<Date | null> {
    const [row] = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
    return row?.inChairAt ?? null;
}

describe('who is in the chair', () => {
    test('walking into an empty chair is arriving and being seated at once', async () => {
        const { visit } = await (async () => {
            const booked = await bookedAppointment(todaySlot());
            return { visit: await visitService.checkIn({ appointmentId: booked.appointment.id }) };
        })();

        const seated = await seatStamp(visit.id);

        expect(seated).not.toBeNull();
        expect(seated?.getTime()).toBe(visit.checkedInAt.getTime());
    });

    test('the second patient through the door has arrived and is not seated', async () => {
        const fixtures = await clinic();

        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        const second = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(60),
            offsetMinutes: 0,
        });

        await visitService.checkIn({ appointmentId: first.id });
        const queued = await visitService.checkIn({ appointmentId: second.id });

        expect(await seatStamp(queued.id)).toBeNull();
    });

    test('going to the desk seats whoever has waited longest', async () => {
        const fixtures = await clinic();

        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        const second = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(60),
            offsetMinutes: 0,
        });
        const third = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(120),
            offsetMinutes: 0,
        });

        const inChair = await visitService.checkIn({ appointmentId: first.id });
        const waiting = await visitService.checkIn({ appointmentId: second.id });
        const behind = await visitService.checkIn({ appointmentId: third.id });

        await appointmentService.awaitPayment(first.id);

        expect(await seatStamp(waiting.id)).not.toBeNull();
        expect(await seatStamp(behind.id)).toBeNull();

        expect(await seatStamp(inChair.id)).not.toBeNull();
    });

    test('the stamp is when the chair emptied, not when the patient arrived', async () => {
        const fixtures = await clinic();

        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
        });
        const second = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(60),
            offsetMinutes: 0,
        });

        await visitService.checkIn({ appointmentId: first.id });
        const waiting = await visitService.checkIn({ appointmentId: second.id });

        await Bun.sleep(20);
        await appointmentService.awaitPayment(first.id);

        const seated = await seatStamp(waiting.id);

        expect(seated).not.toBeNull();
        expect(seated?.getTime()).toBeGreaterThan(waiting.checkedInAt.getTime());
    });

    test('an empty waiting room leaves the chair empty rather than reseating anyone', async () => {
        const booked = await bookedAppointment(todaySlot());
        const only = await visitService.checkIn({ appointmentId: booked.appointment.id });
        const before = await seatStamp(only.id);

        await appointmentService.awaitPayment(booked.appointment.id);

        expect((await seatStamp(only.id))?.getTime()).toBe(before?.getTime());
    });

    test('checking out straight from the chair hands it on too', async () => {
        const fixtures = await clinic();

        const first = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: fixtures.rootCanal.id, quantity: 1 }],
        });
        const second = await appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(60),
            offsetMinutes: 0,
        });

        const inChair = await visitService.checkIn({ appointmentId: first.id });
        const waiting = await visitService.checkIn({ appointmentId: second.id });

        await visitService.checkOut({
            visitId: inChair.id,
            chargedTotal: 0,
            paidTotal: 0,
            method: 'cash',
        });

        expect(await seatStamp(waiting.id)).not.toBeNull();
    });
});

describe('the chair belongs to one clinic day', () => {
    function book(fixtures: Clinic, minutes: number) {
        return appointmentService.create({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            startsAt: todaySlot(minutes),
            offsetMinutes: 0,
        });
    }

    async function leftOverFromYesterday(appointmentId: string): Promise<void> {
        await sql`UPDATE appointments SET starts_at = starts_at - interval '1 day' WHERE id = ${appointmentId}`;
        await sql`
            UPDATE visits
            SET checked_in_at = checked_in_at - interval '1 day',
                in_chair_at = in_chair_at - interval '1 day'
            WHERE appointment_id = ${appointmentId}
        `;
    }

    test("yesterday's patient left in the chair does not keep today's first patient waiting", async () => {
        const fixtures = await clinic();

        const stale = await book(fixtures, 0);
        await visitService.checkIn({ appointmentId: stale.id });
        await leftOverFromYesterday(stale.id);

        const today = await book(fixtures, 60);
        const first = await visitService.checkIn({ appointmentId: today.id });

        expect(await seatStamp(first.id)).not.toBeNull();
    });

    test("going to the desk today does not seat yesterday's queue", async () => {
        const fixtures = await clinic();

        const leaving = await book(fixtures, 0);
        const stale = await book(fixtures, 60);
        await visitService.checkIn({ appointmentId: leaving.id });
        const staleVisit = await visitService.checkIn({ appointmentId: stale.id });
        await leftOverFromYesterday(stale.id);

        const next = await book(fixtures, 120);
        const waiting = await visitService.checkIn({ appointmentId: next.id });

        await appointmentService.awaitPayment(leaving.id, 0);

        expect(await seatStamp(waiting.id)).not.toBeNull();
        expect(await seatStamp(staleVisit.id)).toBeNull();
    });

    test("checking out from the chair today does not seat yesterday's queue", async () => {
        const fixtures = await clinic();

        const leaving = await book(fixtures, 0);
        const stale = await book(fixtures, 60);
        const inChair = await visitService.checkIn({ appointmentId: leaving.id });
        const staleVisit = await visitService.checkIn({ appointmentId: stale.id });
        await leftOverFromYesterday(stale.id);

        const next = await book(fixtures, 120);
        const waiting = await visitService.checkIn({ appointmentId: next.id });

        await visitService.setProcedures({
            visitId: inChair.id,
            procedures: [{ procedureId: fixtures.rootCanal.id, quantity: 1 }],
        });
        await visitService.checkOut({
            visitId: inChair.id,
            chargedTotal: 0,
            paidTotal: 0,
            method: 'cash',
            offsetMinutes: 0,
        });

        expect(await seatStamp(waiting.id)).not.toBeNull();
        expect(await seatStamp(staleVisit.id)).toBeNull();
    });
});
