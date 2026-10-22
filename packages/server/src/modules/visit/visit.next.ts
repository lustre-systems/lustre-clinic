/**
 * The next procedure: what the doctor wants done at the patient's next visit,
 * chosen while recording this one. It lives on the visit (`next_procedure_id`,
 * `next_procedure_tooth`), and `next_appointment_id` is the booking that took it.
 *
 * A booking takes it one of two ways. The patient usually has none yet, so the
 * next one made for them takes it: the booking page offers the line, and
 * `takeNext` marks it taken whether the desk kept the line or not. But the desk
 * is asked to book the return at check-in, before the doctor has seen the
 * patient, so a booking often exists already. Then setting it puts the line on
 * the earliest one still to come instead, which is the booking the patient will
 * actually turn up for.
 *
 * Only the latest visit that set one counts: an older wish the doctor did not
 * repeat is not owed. One whose booking was cancelled or missed is owed again,
 * because the work still has not been done.
 *
 * Kept out of `visit.service.ts` because `appointment.service.ts` needs it and
 * the visit service already imports that one.
 */
import type { Tooth } from '@lustre/shared';
import { and, asc, desc, eq, gt, isNotNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../../db/index.ts';
import { appointmentProcedures, appointments, procedureTypes, visits } from '../../db/schema.ts';

export interface NextProcedure {
    procedureId: string;
    name: string;
    tooth: Tooth | null;
}

export interface PendingNext extends NextProcedure {
    visitId: string;
}

const taker = alias(appointments, 'taker');

/** The next procedure this patient is still owed, or null. */
export async function pendingNext(executor: Executor, patientId: string): Promise<PendingNext | null> {
    const [latest] = await executor
        .select({
            visitId: visits.id,
            procedureId: procedureTypes.id,
            name: procedureTypes.name,
            tooth: visits.nextProcedureTooth,
            takenBy: taker.status,
        })
        .from(visits)
        .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
        .innerJoin(procedureTypes, eq(procedureTypes.id, visits.nextProcedureId))
        .leftJoin(taker, eq(taker.id, visits.nextAppointmentId))
        .where(and(eq(appointments.patientId, patientId), isNotNull(visits.nextProcedureId)))
        .orderBy(desc(visits.checkedInAt))
        .limit(1);

    if (!latest) return null;
    if (latest.takenBy !== null && latest.takenBy !== 'cancelled' && latest.takenBy !== 'no_show') {
        return null;
    }
    return {
        visitId: latest.visitId,
        procedureId: latest.procedureId,
        name: latest.name,
        tooth: latest.tooth,
    };
}

/** A booking was just made for this patient: it takes what they are owed. */
export async function takeNext(tx: Executor, patientId: string, appointmentId: string): Promise<void> {
    const pending = await pendingNext(tx, patientId);
    if (!pending) return;
    await tx.update(visits).set({ nextAppointmentId: appointmentId }).where(eq(visits.id, pending.visitId));
}

/**
 * Records the visit's next procedure, already checked against §5. Returns the
 * booking it was added to, so the caller can tell the screens showing it.
 *
 * Unchanged is left alone, so pressing Confirm again does not add the line to a
 * booking a second time. A change is not taken back off a booking it already
 * went onto: the desk may have planned that line itself.
 */
export async function setNext(
    tx: Executor,
    visit: typeof visits.$inferSelect,
    next: { procedureId: string; tooth: Tooth | null } | null,
    now: Date,
): Promise<string | null> {
    if (next === null) {
        if (visit.nextProcedureId === null) return null;
        await tx
            .update(visits)
            .set({ nextProcedureId: null, nextProcedureTooth: null, nextAppointmentId: null })
            .where(eq(visits.id, visit.id));
        return null;
    }

    if (visit.nextProcedureId === next.procedureId && visit.nextProcedureTooth === next.tooth) return null;

    const [own] = await tx
        .select({ patientId: appointments.patientId })
        .from(appointments)
        .where(eq(appointments.id, visit.appointmentId))
        .limit(1);

    const [upcoming] = own
        ? await tx
              .select({ id: appointments.id })
              .from(appointments)
              .where(
                  and(
                      eq(appointments.patientId, own.patientId),
                      eq(appointments.status, 'booked'),
                      gt(appointments.startsAt, now),
                      ne(appointments.id, visit.appointmentId),
                      eq(appointments.isImported, false),
                      eq(appointments.isOpeningBalance, false),
                  ),
              )
              .orderBy(asc(appointments.startsAt))
              .limit(1)
        : [];

    if (upcoming) await addLine(tx, upcoming.id, next);

    await tx
        .update(visits)
        .set({
            nextProcedureId: next.procedureId,
            nextProcedureTooth: next.tooth,
            nextAppointmentId: upcoming?.id ?? null,
        })
        .where(eq(visits.id, visit.id));

    return upcoming?.id ?? null;
}

/** Last on the booking's plan, unless the plan already has it. */
async function addLine(
    tx: Executor,
    appointmentId: string,
    next: { procedureId: string; tooth: Tooth | null },
): Promise<void> {
    const lines = await tx
        .select({
            procedureId: appointmentProcedures.procedureId,
            tooth: appointmentProcedures.tooth,
            sortOrder: appointmentProcedures.sortOrder,
        })
        .from(appointmentProcedures)
        .where(eq(appointmentProcedures.appointmentId, appointmentId));

    if (lines.some((line) => line.procedureId === next.procedureId && line.tooth === next.tooth)) return;

    await tx.insert(appointmentProcedures).values({
        id: Bun.randomUUIDv7(),
        appointmentId,
        procedureId: next.procedureId,
        quantity: 1,
        tooth: next.tooth,
        sortOrder: Math.max(-1, ...lines.map((line) => line.sortOrder)) + 1,
    });
}
