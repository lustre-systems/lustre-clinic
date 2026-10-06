/**
 * `server/src/modules/visit/visit.service.ts`. A visit is what happened, as
 * opposed to what was scheduled.
 *
 * Check-in creates it and seeds its lines: one per procedure the booking
 * planned, each priced at the catalogue price on the day rather than at
 * booking, and nothing else — the checkup is picked like any other line, as on
 * the server. Pricing is not a prerequisite for
 * checkout, and zero paid is a valid checkout, because the balance is derived.
 */
import { canTransition, ERROR_CODE, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, type PaymentRow, save, type VisitProcedureRow, type VisitRow } from '../db';
import { broadcast } from '../events';
import { clinicDayOf, computeTotal, DemoError, resolveProcedureLines, uuidv7 } from '../rules';
import type { Dated } from '../wire';

type Visit = Dated<RouterOutput['visit']['byId']>;
type VisitLine = Visit['procedures'][number];
type ClinicDay = ReturnType<typeof clinicDayOf>;

function onDay(at: Date, day: ClinicDay): boolean {
    return at >= day.from && at < day.to;
}

function requireVisit(id: string): VisitRow {
    const row = getDb().visits.find((visit) => visit.id === id);
    if (!row) throw DemoError.notFound('visit');
    return row;
}

function isCheckup(procedureId: string): boolean {
    return getDb().procedureTypes.find((row) => row.id === procedureId)?.isCheckup ?? false;
}

function nameOf(procedureId: string): string {
    return getDb().procedureTypes.find((row) => row.id === procedureId)?.name ?? 'Procedure';
}

function linesOf(visitId: string): VisitProcedureRow[] {
    return getDb().visitProcedures.filter((line) => line.visitId === visitId);
}

function recompute(visitId: string): number {
    const computedTotal = computeTotal(
        linesOf(visitId).map((line) => ({
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            isCheckup: isCheckup(line.procedureId),
        })),
    );

    requireVisit(visitId).computedTotal = computedTotal;
    return computedTotal;
}

/**
 * "In the chair" is a stamp, not a position in a queue: `inChairAt` set and the
 * appointment still `checked_in`. Once they go to the desk or are checked out
 * the status moves on and the chair reads empty again. Asked of one clinic day,
 * so a patient nobody checked out yesterday does not hold today's chair.
 */
function chairIsTaken(branchId: string, day: ClinicDay): boolean {
    const db = getDb();
    return db.visits.some((visit) => {
        if (!visit.inChairAt) return false;
        const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
        return (
            appointment?.branchId === branchId &&
            appointment.status === 'checked_in' &&
            onDay(appointment.startsAt, day)
        );
    });
}

/**
 * Move the longest-waiting patient into the chair the moment it empties.
 *
 * Called from both ways out of the chair — to the desk (`awaitPayment`) and
 * straight to checkout — because the patient who has been waiting since 08:24
 * began their visit when the person ahead of them got up, not when they
 * arrived. The day view's bar measures from `inChairAt` for exactly this. The
 * queue is the leaving appointment's own day, never an earlier day's leftovers.
 */
export function seatNextInChair(branchId: string, day: ClinicDay, now: Date): void {
    const db = getDb();

    const next = db.visits
        .filter((visit) => {
            if (visit.inChairAt) return false;
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return (
                appointment?.branchId === branchId &&
                appointment.status === 'checked_in' &&
                onDay(appointment.startsAt, day)
            );
        })
        .sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime())[0];

    if (!next) return;
    next.inChairAt = now;
}

/** The one place a payment row is written, shared with `balance.settle`. */
export function insertPayment(
    visitId: string,
    amount: number,
    method: PaymentRow['method'],
    methodNote: string | null,
): void {
    if (method === 'other' && !methodNote?.trim()) {
        throw new DemoError(ERROR_CODE.PAYMENT_NOTE_REQUIRED, "method 'other' requires a note", 422);
    }

    getDb().payments.push({ id: uuidv7(), visitId, amount, method, methodNote, paidAt: new Date() });
}

function collectedOn(visitId: string): number {
    return getDb()
        .payments.filter((payment) => payment.visitId === visitId)
        .reduce((sum, payment) => sum + payment.amount, 0);
}

function readVisit(id: string): Visit {
    const db = getDb();
    const visit = requireVisit(id);

    const procedures: VisitLine[] = linesOf(id).map((line) => ({
        id: line.id,
        procedureId: line.procedureId,
        name: nameOf(line.procedureId),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isCheckup: isCheckup(line.procedureId),
        tooth: line.tooth,
        note: line.note,
        lineTotal: line.unitPrice * line.quantity,
    }));

    const payments = db.payments
        .filter((payment) => payment.visitId === id)
        .map((payment) => ({
            id: payment.id,
            amount: payment.amount,
            method: payment.method,
            methodNote: payment.methodNote,
            paidAt: payment.paidAt,
        }));

    const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);

    return { ...visit, procedures, payments, paidTotal, balance: visit.chargedTotal - paidTotal };
}

export const visitHandlers = {
    checkIn(input: RouterInput['visit']['checkIn']): VisitRow {
        const db = getDb();
        const appointment = db.appointments.find((row) => row.id === input.appointmentId);
        if (!appointment) throw DemoError.notFound('appointment');

        if (db.visits.some((visit) => visit.appointmentId === appointment.id)) {
            throw new DemoError(ERROR_CODE.VISIT_ALREADY_EXISTS, 'this appointment already has a visit', 409);
        }

        if (!canTransition(appointment.status, 'checked_in')) {
            throw new DemoError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot check in an appointment that is ${appointment.status}`,
                422,
            );
        }

        const now = new Date();
        const today = clinicDayOf(now, input.offsetMinutes ?? 0);

        // Only on the day they are booked for. From another day's list it is a
        // mis-tap, and the visit would sit checked in with nobody to close it.
        // A walk-in is checked in by the call that creates it, and a queue
        // running past midnight can start it on the next day, so it is exempt.
        if (appointment.channel !== 'walk_in' && !onDay(appointment.startsAt, today)) {
            throw new DemoError(
                ERROR_CODE.CHECK_IN_NOT_TODAY,
                "cannot check in an appointment that is not on today's clinic day",
                422,
            );
        }

        // Walking into an empty chair is the common case at a quiet clinic, and
        // it is the one where arriving and being seated are the same moment.
        const waiting = chairIsTaken(appointment.branchId, today);

        const visit: VisitRow = {
            id: uuidv7(),
            appointmentId: appointment.id,
            checkedInAt: now,
            inChairAt: waiting ? null : now,
            pricedAt: null,
            completedAt: null,
            computedTotal: 0,
            chargedTotal: 0,
            createdAt: now,
        };
        db.visits.push(visit);

        appointment.status = 'checked_in';
        appointment.updatedAt = now;

        const planned = db.appointmentProcedures
            .filter((line) => line.appointmentId === appointment.id)
            .sort((a, b) => a.sortOrder - b.sortOrder);

        for (const line of planned) {
            const procedure = db.procedureTypes.find((row) => row.id === line.procedureId);
            db.visitProcedures.push({
                id: uuidv7(),
                visitId: visit.id,
                procedureId: line.procedureId,
                quantity: line.quantity,
                unitPrice: line.quotedPrice ?? procedure?.defaultPrice ?? 0,
                tooth: line.tooth,
                note: line.note,
            });
        }

        visit.chargedTotal = recompute(visit.id);

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        return visit;
    },

    byId(input: RouterInput['visit']['byId']): Visit {
        return readVisit(input.id);
    },

    byAppointment(input: RouterInput['visit']['byAppointment']): VisitRow | null {
        return getDb().visits.find((visit) => visit.appointmentId === input.appointmentId) ?? null;
    },

    setProcedures(input: RouterInput['visit']['setProcedures']): Visit {
        const db = getDb();
        const visit = requireVisit(input.visitId);

        if (visit.completedAt) {
            throw new DemoError(ERROR_CODE.VISIT_ALREADY_COMPLETED, 'this visit is already checked out', 409);
        }

        const requested = input.procedures.map((line) => ({
            procedureId: line.procedureId,
            quantity: line.quantity ?? 1,
            tooth: line.tooth,
            note: line.note,
        }));
        const resolved = resolveProcedureLines(
            requested,
            db.procedureTypes,
            db.settings.clinicType === 'general',
        );

        db.visitProcedures = db.visitProcedures.filter((line) => line.visitId !== visit.id);

        for (const [index, line] of resolved.entries()) {
            db.visitProcedures.push({
                id: uuidv7(),
                visitId: visit.id,
                procedureId: line.procedure.id,
                quantity: line.quantity,
                unitPrice: input.procedures[index]?.unitPrice ?? line.procedure.defaultPrice,
                tooth: line.tooth,
                note: line.note,
            });
        }

        const computedTotal = recompute(visit.id);
        // The charged total tracks the computed one until someone has edited it.
        if (!visit.pricedAt) visit.chargedTotal = computedTotal;

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(visit.id);
    },

    setPrice(input: RouterInput['visit']['setPrice']): Visit {
        const visit = requireVisit(input.visitId);

        if (visit.completedAt) {
            throw new DemoError(ERROR_CODE.VISIT_ALREADY_COMPLETED, 'this visit is already checked out', 409);
        }

        visit.chargedTotal = input.chargedTotal;
        visit.pricedAt = new Date();

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(visit.id);
    },

    checkOut(input: RouterInput['visit']['checkOut']): Visit {
        const db = getDb();
        const visit = requireVisit(input.visitId);

        if (visit.completedAt) {
            throw new DemoError(ERROR_CODE.VISIT_ALREADY_COMPLETED, 'this visit is already checked out', 409);
        }

        const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
        if (!appointment) throw DemoError.notFound('appointment');

        // As the server: an ordinary visit needs a line to be closed, and an
        // opening balance never has one.
        if (!appointment.isOpeningBalance && linesOf(visit.id).length === 0) {
            throw new DemoError(
                ERROR_CODE.VISIT_HAS_NO_PROCEDURES,
                'cannot check out a visit with no procedures',
                422,
            );
        }

        // Closing a visit that was reopened to be corrected: the appointment
        // never left `done`, so there is no transition to make.
        const reclosing = appointment.status === 'done';

        if (!reclosing && !canTransition(appointment.status, 'done')) {
            throw new DemoError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot check out an appointment that is ${appointment.status}`,
                422,
            );
        }

        const now = new Date();
        const paidTotal = input.paidTotal ?? 0;

        // As the server: the desk's phone clamps to what is owed, a doctor's is
        // not shown what was already paid, so the rule is here too.
        if (paidTotal > 0 && paidTotal > input.chargedTotal - collectedOn(visit.id)) {
            throw new DemoError(
                ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
                'the payment is more than is owed on this visit',
                422,
            );
        }

        visit.chargedTotal = input.chargedTotal;
        visit.pricedAt = visit.pricedAt ?? now;
        visit.completedAt = now;

        if (paidTotal > 0) {
            insertPayment(visit.id, paidTotal, input.method, input.methodNote ?? null);
        }

        if (!reclosing) {
            const wasInChair = appointment.status === 'checked_in';
            appointment.status = 'done';
            appointment.updatedAt = now;

            // Reclosing a corrected visit does not empty the chair — that
            // patient left long ago, and seating someone off it would restart a
            // bar that is already running.
            if (wasInChair) {
                seatNextInChair(
                    appointment.branchId,
                    clinicDayOf(appointment.startsAt, input.offsetMinutes ?? 0),
                    now,
                );
            }
        }

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        return readVisit(visit.id);
    },

    /**
     * Correct what a visit was paid, in total. What is written is the
     * difference, as a payment row of its own — a refund is a negative payment,
     * dated the day the correction was made. Nothing is edited and nothing is
     * deleted, because the original row is still a true record of what was
     * entered at the time.
     *
     * Raising the total past the charge is refused, as on the server; lowering
     * it never is, because that is the refund of a charge that came down.
     */
    setPaid(input: RouterInput['visit']['setPaid']): Visit {
        const visit = requireVisit(input.visitId);

        const delta = input.paidTotal - collectedOn(visit.id);
        if (delta > 0 && input.paidTotal > visit.chargedTotal) {
            throw new DemoError(
                ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
                'the paid total is more than this visit charges',
                422,
            );
        }
        if (delta !== 0) insertPayment(visit.id, delta, input.method, input.methodNote ?? null);

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(visit.id);
    },

    recordPayment(input: RouterInput['visit']['recordPayment']): Visit {
        const visit = requireVisit(input.visitId);
        insertPayment(visit.id, input.amount, input.method, input.methodNote ?? null);

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(visit.id);
    },

    /**
     * Unlock a finished visit so it can be corrected. The *appointment* is not
     * touched — the patient came, was seen and went home, and someone fixing
     * the paperwork three weeks later does not undo that. `pricedAt` is cleared
     * with `completedAt`, or `setProcedures` would recompute around a pinned
     * `chargedTotal` and the bill would not follow the lines.
     */
    reopen(input: RouterInput['visit']['reopen']): Visit {
        const visit = requireVisit(input.visitId);

        if (!visit.completedAt) {
            throw new DemoError(ERROR_CODE.INVALID_STATUS_TRANSITION, 'this visit is not checked out', 422);
        }

        visit.completedAt = null;
        visit.pricedAt = null;

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(visit.id);
    },

    delete(input: RouterInput['visit']['delete']): void {
        const db = getDb();
        const visit = requireVisit(input.visitId);

        if (db.payments.some((row) => row.visitId === visit.id)) {
            throw new DemoError(ERROR_CODE.HAS_PAYMENTS, 'this visit has payments recorded on it', 409);
        }

        const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
        if (!appointment) throw DemoError.notFound('appointment');

        db.visitProcedures = db.visitProcedures.filter((line) => line.visitId !== visit.id);
        db.visits = db.visits.filter((row) => row.id !== visit.id);

        const now = new Date();
        // Read before the branch below rewrites it: `appointment` is the row
        // itself here, not a copy, so setting it to `booked` would make the
        // chair check under it false for every desk booking.
        const heldTheChair = appointment.status === 'checked_in' && visit.inChairAt !== null;

        if (appointment.channel === 'walk_in' || appointment.isOpeningBalance) {
            db.reminders = db.reminders.filter((row) => row.appointmentId !== appointment.id);
            db.appointmentProcedures = db.appointmentProcedures.filter(
                (row) => row.appointmentId !== appointment.id,
            );
            db.appointments = db.appointments.filter((row) => row.id !== appointment.id);
        } else {
            appointment.status = 'booked';
            appointment.updatedAt = now;
        }

        if (heldTheChair) {
            seatNextInChair(
                appointment.branchId,
                clinicDayOf(appointment.startsAt, input.offsetMinutes ?? 0),
                now,
            );
        }

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
    },

    deletePayment(input: RouterInput['visit']['deletePayment']): Visit {
        const db = getDb();
        const row = db.payments.find((payment) => payment.id === input.paymentId);
        if (!row) throw DemoError.notFound('payment');

        db.payments = db.payments.filter((payment) => payment.id !== row.id);

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(row.visitId);
    },
};
