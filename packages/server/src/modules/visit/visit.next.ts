/**
 * The next procedures: what the doctor wants done at the patient's next visit,
 * chosen while recording this one. They live in `visit_next_procedures`, and
 * the visit's `next_appointment_id` is the booking that took them — all of
 * them, since they are one return visit's worth of work.
 *
 * A booking takes them one of two ways. The patient usually has none yet, so
 * the next one made for them takes them: the booking page offers the lines, and
 * `takeNext` marks them taken whether the desk kept the lines or not. But the
 * desk is asked to book the return at check-in, before the doctor has seen the
 * patient, so a booking often exists already. Then setting them puts the lines
 * on the earliest one still to come instead, which is the booking the patient
 * will actually turn up for.
 *
 * Only the latest visit that set any counts: an older wish the doctor did not
 * repeat is not owed. Ones whose booking was cancelled or missed are owed
 * again, because the work still has not been done.
 *
 * Kept out of `visit.service.ts` because `appointment.service.ts` needs it and
 * the visit service already imports that one.
 */
import type { Tooth } from '@lustre/shared';
import { and, asc, desc, eq, exists, gt, ne } from 'drizzle-orm';
import type { Executor } from '../../db/index.ts';
import {
    appointmentProcedures,
    appointments,
    procedureTypes,
    visitNextProcedures,
    visits,
} from '../../db/schema.ts';

export interface NextProcedure {
    procedureId: string;
    name: string;
    tooth: Tooth | null;
}

interface NextLine {
    procedureId: string;
    tooth: Tooth | null;
}

/** A booking cancelled or missed did not do the work, so what it took is owed again. */
function stillStanding(status: string | null | undefined): boolean {
    return status != null && status !== 'cancelled' && status !== 'no_show';
}

/** The visit's next procedures in the doctor's order, with their names. */
export async function nextOf(executor: Executor, visitId: string): Promise<NextProcedure[]> {
    return executor
        .select({
            procedureId: visitNextProcedures.procedureId,
            name: procedureTypes.name,
            tooth: visitNextProcedures.tooth,
        })
        .from(visitNextProcedures)
        .innerJoin(procedureTypes, eq(procedureTypes.id, visitNextProcedures.procedureId))
        .where(eq(visitNextProcedures.visitId, visitId))
        .orderBy(asc(visitNextProcedures.sortOrder));
}

/** The booking that took the visit's next procedures, while it still stands to do them. */
export async function takenBy(executor: Executor, appointmentId: string | null): Promise<string | null> {
    if (!appointmentId) return null;
    const [taker] = await executor
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
    return stillStanding(taker?.status) ? appointmentId : null;
}

/** What this patient is still owed, and the visit that asked for it; none is an empty list. */
async function owed(
    executor: Executor,
    patientId: string,
): Promise<{ visitId: string; procedures: NextProcedure[] } | null> {
    const [latest] = await executor
        .select({ visitId: visits.id, takenBy: visits.nextAppointmentId })
        .from(visits)
        .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
        .where(
            and(
                eq(appointments.patientId, patientId),
                exists(
                    executor
                        .select({ id: visitNextProcedures.id })
                        .from(visitNextProcedures)
                        .where(eq(visitNextProcedures.visitId, visits.id)),
                ),
            ),
        )
        .orderBy(desc(visits.checkedInAt))
        .limit(1);

    if (!latest || (await takenBy(executor, latest.takenBy))) return null;
    return { visitId: latest.visitId, procedures: await nextOf(executor, latest.visitId) };
}

/** The next procedures this patient is still owed, in order; empty when none. */
export async function pendingNext(executor: Executor, patientId: string): Promise<NextProcedure[]> {
    return (await owed(executor, patientId))?.procedures ?? [];
}

/** A booking was just made for this patient: it takes what they are owed. */
export async function takeNext(tx: Executor, patientId: string, appointmentId: string): Promise<void> {
    const pending = await owed(tx, patientId);
    if (!pending) return;
    await tx.update(visits).set({ nextAppointmentId: appointmentId }).where(eq(visits.id, pending.visitId));
}

function sameLines(a: readonly NextLine[], b: readonly NextLine[]): boolean {
    return (
        a.length === b.length &&
        a.every((line, i) => line.procedureId === b[i]?.procedureId && line.tooth === b[i]?.tooth)
    );
}

/**
 * Records the visit's next procedures, already checked against §5. Returns the
 * booking they were added to, so the caller can tell the screens showing it.
 *
 * Unchanged is left alone, so pressing Confirm again does not add the lines to
 * a booking a second time. A change is not taken back off a booking it already
 * went onto: the desk may have planned that line itself.
 */
export async function setNext(
    tx: Executor,
    visit: typeof visits.$inferSelect,
    next: readonly NextLine[],
    now: Date,
): Promise<string | null> {
    const current = await nextOf(tx, visit.id);
    if (sameLines(current, next)) return null;

    await tx.delete(visitNextProcedures).where(eq(visitNextProcedures.visitId, visit.id));

    if (next.length === 0) {
        await tx.update(visits).set({ nextAppointmentId: null }).where(eq(visits.id, visit.id));
        return null;
    }

    await tx.insert(visitNextProcedures).values(
        next.map((line, i) => ({
            id: Bun.randomUUIDv7(),
            visitId: visit.id,
            procedureId: line.procedureId,
            tooth: line.tooth,
            sortOrder: i,
        })),
    );

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

    if (upcoming) await addLines(tx, upcoming.id, next);

    await tx
        .update(visits)
        .set({ nextAppointmentId: upcoming?.id ?? null })
        .where(eq(visits.id, visit.id));

    return upcoming?.id ?? null;
}

/** Last on the booking's plan, each unless the plan already has it. */
async function addLines(tx: Executor, appointmentId: string, next: readonly NextLine[]): Promise<void> {
    const lines = await tx
        .select({
            procedureId: appointmentProcedures.procedureId,
            tooth: appointmentProcedures.tooth,
            sortOrder: appointmentProcedures.sortOrder,
        })
        .from(appointmentProcedures)
        .where(eq(appointmentProcedures.appointmentId, appointmentId));

    const missing = next.filter(
        (want) => !lines.some((line) => line.procedureId === want.procedureId && line.tooth === want.tooth),
    );
    if (missing.length === 0) return;

    const last = Math.max(-1, ...lines.map((line) => line.sortOrder));
    await tx.insert(appointmentProcedures).values(
        missing.map((line, i) => ({
            id: Bun.randomUUIDv7(),
            appointmentId,
            procedureId: line.procedureId,
            quantity: 1,
            tooth: line.tooth,
            sortOrder: last + 1 + i,
        })),
    );
}
