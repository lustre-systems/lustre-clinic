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

function stillStanding(status: string | null | undefined): boolean {
    return status != null && status !== 'cancelled' && status !== 'no_show';
}

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

export async function takenBy(executor: Executor, appointmentId: string | null): Promise<string | null> {
    if (!appointmentId) return null;
    const [taker] = await executor
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
    return stillStanding(taker?.status) ? appointmentId : null;
}

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

export async function pendingNext(executor: Executor, patientId: string): Promise<NextProcedure[]> {
    return (await owed(executor, patientId))?.procedures ?? [];
}

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
