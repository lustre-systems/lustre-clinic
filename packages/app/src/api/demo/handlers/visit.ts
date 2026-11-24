import { canTransition, ERROR_CODE, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, type PaymentRow, save, type VisitProcedureRow, type VisitRow } from '../db';
import { broadcast } from '../events';
import { clinicDayOf, computeTotal, DemoError, resolveProcedureLines, uuidv7 } from '../rules';
import type { Dated } from '../wire';
import { nextOf, pendingNext, setNext, takenBy } from './visitNext';

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
    const row = requireVisit(id);
    const { nextProcedures: _stored, ...visit } = row;

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

    const nextProcedures = nextOf(row);
    const nextAppointmentId = takenBy(visit.nextAppointmentId);

    return {
        ...visit,
        nextAppointmentId,
        nextProcedures,
        nextProcedure: nextProcedures[0] ? { ...nextProcedures[0], appointmentId: nextAppointmentId } : null,
        procedures,
        payments,
        paidTotal,
        balance: visit.chargedTotal - paidTotal,
    };
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

        if (appointment.channel !== 'walk_in' && !onDay(appointment.startsAt, today)) {
            throw new DemoError(
                ERROR_CODE.CHECK_IN_NOT_TODAY,
                "cannot check in an appointment that is not on today's clinic day",
                422,
            );
        }

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
            nextProcedures: [],
            nextAppointmentId: null,
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
                unitCost: procedure?.cost ?? 0,
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
        const asked =
            input.nextProcedures ??
            (input.nextProcedure === undefined
                ? undefined
                : input.nextProcedure
                  ? [input.nextProcedure]
                  : []);
        const next =
            asked === undefined
                ? undefined
                : resolveProcedureLines(
                      asked.map((line) => ({ ...line, quantity: 1 })),
                      db.procedureTypes,
                      db.settings.clinicType === 'general',
                  ).map((line) => ({ procedureId: line.procedure.id, tooth: line.tooth }));

        const savedCost = new Map(
            db.visitProcedures
                .filter((line) => line.visitId === visit.id)
                .map((line) => [line.procedureId, line.unitCost]),
        );
        db.visitProcedures = db.visitProcedures.filter((line) => line.visitId !== visit.id);

        for (const [index, line] of resolved.entries()) {
            db.visitProcedures.push({
                id: uuidv7(),
                visitId: visit.id,
                procedureId: line.procedure.id,
                quantity: line.quantity,
                unitPrice: input.procedures[index]?.unitPrice ?? line.procedure.defaultPrice,
                unitCost: savedCost.get(line.procedure.id) ?? line.procedure.cost,
                tooth: line.tooth,
                note: line.note,
            });
        }

        const computedTotal = recompute(visit.id);
        if (!visit.pricedAt) visit.chargedTotal = computedTotal;

        const booked = next === undefined ? null : setNext(visit, next, new Date());

        save();
        if (booked) broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        broadcast(WS_EVENT.VISIT_UPDATED);
        return readVisit(visit.id);
    },

    pendingNextProcedures(
        input: RouterInput['visit']['pendingNextProcedures'],
    ): RouterOutput['visit']['pendingNextProcedures'] {
        return pendingNext(input.patientId);
    },

    pendingNext(input: RouterInput['visit']['pendingNext']): RouterOutput['visit']['pendingNext'] {
        return pendingNext(input.patientId)[0] ?? null;
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

        if (!appointment.isOpeningBalance && linesOf(visit.id).length === 0) {
            throw new DemoError(
                ERROR_CODE.VISIT_HAS_NO_PROCEDURES,
                'cannot check out a visit with no procedures',
                422,
            );
        }

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

    setPaidMethod(input: RouterInput['visit']['setPaidMethod']): Visit {
        const visit = requireVisit(input.visitId);
        const methodNote = input.method === 'other' ? (input.methodNote?.trim() ?? null) : null;
        if (input.method === 'other' && !methodNote) {
            throw new DemoError(ERROR_CODE.PAYMENT_NOTE_REQUIRED, "method 'other' requires a note", 422);
        }

        const keyOf = (method: PaymentRow['method'], note: string | null) =>
            method === 'other' ? `other:${note?.trim() ?? ''}` : method;
        const target = keyOf(input.method, methodNote);

        const nets = new Map<
            string,
            { amount: number; method: PaymentRow['method']; methodNote: string | null }
        >();
        for (const row of getDb().payments.filter((payment) => payment.visitId === visit.id)) {
            const key = keyOf(row.method, row.methodNote);
            const net = nets.get(key);
            if (net) net.amount += row.amount;
            else nets.set(key, { amount: row.amount, method: row.method, methodNote: row.methodNote });
        }

        let moved = 0;
        for (const [key, net] of nets) {
            if (key === target || net.amount === 0) continue;
            insertPayment(visit.id, -net.amount, net.method, net.methodNote);
            moved += net.amount;
        }
        if (moved !== 0) insertPayment(visit.id, moved, input.method, methodNote);

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
