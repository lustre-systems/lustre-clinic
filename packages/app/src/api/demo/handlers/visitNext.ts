/**
 * `server/src/modules/visit/visit.next.ts`. The next procedures: chosen on a
 * visit, taken by the patient's next booking — the one made after it, or the
 * earliest one already waiting, which gets the lines added.
 */
import type { Tooth } from '@lustre/shared';
import { getDb, type VisitRow } from '../db';
import { uuidv7 } from '../rules';

interface NextLine {
    procedureId: string;
    tooth: Tooth | null;
}

export interface NextProcedure extends NextLine {
    name: string;
}

/** The booking that took them, while it still stands to do them. */
export function takenBy(appointmentId: string | null): string | null {
    const taker = getDb().appointments.find((row) => row.id === appointmentId);
    return taker && taker.status !== 'cancelled' && taker.status !== 'no_show' ? taker.id : null;
}

/** The visit's next procedures in order, with their names. */
export function nextOf(visit: VisitRow): NextProcedure[] {
    const db = getDb();
    return visit.nextProcedures.flatMap((line) => {
        const procedure = db.procedureTypes.find((row) => row.id === line.procedureId);
        return procedure ? [{ procedureId: procedure.id, name: procedure.name, tooth: line.tooth }] : [];
    });
}

function owed(patientId: string): VisitRow | null {
    const db = getDb();
    const latest = db.visits
        .filter(
            (visit) =>
                visit.nextProcedures.length > 0 &&
                db.appointments.some((row) => row.id === visit.appointmentId && row.patientId === patientId),
        )
        .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())[0];
    return latest && !takenBy(latest.nextAppointmentId) ? latest : null;
}

export function pendingNext(patientId: string): NextProcedure[] {
    const visit = owed(patientId);
    return visit ? nextOf(visit) : [];
}

export function takeNext(patientId: string, appointmentId: string): void {
    const visit = owed(patientId);
    if (visit) visit.nextAppointmentId = appointmentId;
}

/** Returns the booking the lines were added to, if any. */
export function setNext(visit: VisitRow, next: readonly NextLine[], now: Date): string | null {
    const same =
        visit.nextProcedures.length === next.length &&
        visit.nextProcedures.every(
            (line, i) => line.procedureId === next[i]?.procedureId && line.tooth === next[i]?.tooth,
        );
    if (same) return null;

    visit.nextProcedures = next.map((line) => ({ procedureId: line.procedureId, tooth: line.tooth }));
    if (next.length === 0) {
        visit.nextAppointmentId = null;
        return null;
    }

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
        let sortOrder = Math.max(-1, ...lines.map((line) => line.sortOrder));
        for (const want of next) {
            if (lines.some((line) => line.procedureId === want.procedureId && line.tooth === want.tooth))
                continue;
            sortOrder += 1;
            db.appointmentProcedures.push({
                id: uuidv7(),
                appointmentId: upcoming.id,
                procedureId: want.procedureId,
                quantity: 1,
                tooth: want.tooth,
                note: null,
                quotedPrice: null,
                sortOrder,
            });
        }
    }

    visit.nextAppointmentId = upcoming?.id ?? null;
    return upcoming?.id ?? null;
}
