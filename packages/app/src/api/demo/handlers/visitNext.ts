/**
 * `server/src/modules/visit/visit.next.ts`. The next procedure: chosen on a
 * visit, taken by the patient's next booking — the one made after it, or the
 * earliest one already waiting, which gets the line added.
 */
import type { Tooth } from '@lustre/shared';
import { getDb, type VisitRow } from '../db';
import { uuidv7 } from '../rules';

interface PendingNext {
    visitId: string;
    procedureId: string;
    name: string;
    tooth: Tooth | null;
}

export function pendingNext(patientId: string): PendingNext | null {
    const db = getDb();
    const latest = db.visits
        .filter(
            (visit) =>
                visit.nextProcedureId !== null &&
                db.appointments.some((row) => row.id === visit.appointmentId && row.patientId === patientId),
        )
        .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())[0];
    if (!latest?.nextProcedureId) return null;

    const taker = db.appointments.find((row) => row.id === latest.nextAppointmentId);
    if (taker && taker.status !== 'cancelled' && taker.status !== 'no_show') return null;

    const procedure = db.procedureTypes.find((row) => row.id === latest.nextProcedureId);
    if (!procedure) return null;
    return {
        visitId: latest.id,
        procedureId: procedure.id,
        name: procedure.name,
        tooth: latest.nextProcedureTooth,
    };
}

export function takeNext(patientId: string, appointmentId: string): void {
    const pending = pendingNext(patientId);
    const visit = pending && getDb().visits.find((row) => row.id === pending.visitId);
    if (visit) visit.nextAppointmentId = appointmentId;
}

/** Returns the booking the line was added to, if any. */
export function setNext(
    visit: VisitRow,
    next: { procedureId: string; tooth: Tooth | null } | null,
    now: Date,
): string | null {
    if (next === null) {
        visit.nextProcedureId = null;
        visit.nextProcedureTooth = null;
        visit.nextAppointmentId = null;
        return null;
    }
    if (visit.nextProcedureId === next.procedureId && visit.nextProcedureTooth === next.tooth) return null;

    const db = getDb();
    const own = db.appointments.find((row) => row.id === visit.appointmentId);
    const upcoming = db.appointments
        .filter(
            (row) =>
                row.patientId === own?.patientId &&
                row.status === 'booked' &&
                row.startsAt > now &&
                row.id !== visit.appointmentId &&
                !row.isImported &&
                !row.isOpeningBalance,
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

    if (upcoming) {
        const lines = db.appointmentProcedures.filter((line) => line.appointmentId === upcoming.id);
        if (!lines.some((line) => line.procedureId === next.procedureId && line.tooth === next.tooth)) {
            db.appointmentProcedures.push({
                id: uuidv7(),
                appointmentId: upcoming.id,
                procedureId: next.procedureId,
                quantity: 1,
                tooth: next.tooth,
                note: null,
                quotedPrice: null,
                sortOrder: Math.max(-1, ...lines.map((line) => line.sortOrder)) + 1,
            });
        }
    }

    visit.nextProcedureId = next.procedureId;
    visit.nextProcedureTooth = next.tooth;
    visit.nextAppointmentId = upcoming?.id ?? null;
    return upcoming?.id ?? null;
}
