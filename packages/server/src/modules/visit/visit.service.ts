import { canTransition, ERROR_CODE, type Role, seesPayments, type Tooth, WS_EVENT } from '@lustre/shared';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import {
    appointmentProcedures,
    appointments,
    payments,
    procedureTypes,
    reminders,
    visitProcedures,
    visits,
} from '../../db/schema.ts';
import { AppError, PG_ERROR, pgErrorCode } from '../../errors/AppError.ts';
import { computeTotal } from '../../util/money.ts';
import { clinicDayOf } from '../../util/time.ts';
import { broadcast } from '../../ws/index.ts';
import { resolveProcedureLines } from '../procedure/procedure.rules.ts';
import { type NextProcedure, nextOf, pendingNext, setNext, takenBy } from './visit.next.ts';
import type {
    CheckInInput,
    CheckOutInput,
    DeletePaymentInput,
    DeleteVisitInput,
    RecordPaymentInput,
    ReopenInput,
    SetPaidInput,
    SetPaidMethodInput,
    SetPriceInput,
    SetProceduresInput,
} from './visit.schema.ts';

type VisitRow = typeof visits.$inferSelect;

type ClinicDay = ReturnType<typeof clinicDayOf>;

interface VisitLine {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
    unitPrice: number | null;
    isCheckup: boolean;
    tooth: Tooth | null;
    note: string | null;
    lineTotal: number | null;
}

interface VisitPayment {
    id: string;
    amount: number;
    method: string;
    methodNote: string | null;
    paidAt: Date;
}

interface Visit extends Omit<VisitRow, 'chargedTotal' | 'computedTotal'> {
    chargedTotal: number | null;
    computedTotal: number | null;
    nextProcedures: NextProcedure[];
    nextProcedure: (NextProcedure & { appointmentId: string | null }) | null;
    procedures: VisitLine[];
    payments: VisitPayment[] | null;
    paidTotal: number | null;
    balance: number | null;
}

type Viewer = Role | null | undefined;

async function requireVisit(executor: Executor, id: string): Promise<VisitRow> {
    const [row] = await executor.select().from(visits).where(eq(visits.id, id)).limit(1);
    if (!row) throw AppError.notFound('visit');
    return row;
}

async function recompute(executor: Executor, visitId: string): Promise<number> {
    const lines = await executor
        .select({
            unitPrice: visitProcedures.unitPrice,
            quantity: visitProcedures.quantity,
            isCheckup: procedureTypes.isCheckup,
        })
        .from(visitProcedures)
        .innerJoin(procedureTypes, eq(visitProcedures.procedureId, procedureTypes.id))
        .where(eq(visitProcedures.visitId, visitId));

    const computedTotal = computeTotal(lines);
    await executor.update(visits).set({ computedTotal }).where(eq(visits.id, visitId));
    return computedTotal;
}

async function chairIsTaken(tx: Executor, branchId: string, day: ClinicDay): Promise<boolean> {
    const [seated] = await tx
        .select({ id: visits.id })
        .from(visits)
        .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
        .where(
            and(
                eq(appointments.branchId, branchId),
                eq(appointments.status, 'checked_in'),
                gte(appointments.startsAt, day.from),
                lt(appointments.startsAt, day.to),
                sql`${visits.inChairAt} is not null`,
            ),
        )
        .limit(1);

    return seated !== undefined;
}

export async function seatNextInChair(
    tx: Executor,
    branchId: string,
    day: ClinicDay,
    now: Date,
): Promise<void> {
    const [next] = await tx
        .select({ visitId: visits.id })
        .from(visits)
        .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
        .where(
            and(
                eq(appointments.branchId, branchId),
                eq(appointments.status, 'checked_in'),
                gte(appointments.startsAt, day.from),
                lt(appointments.startsAt, day.to),
                isNull(visits.inChairAt),
            ),
        )
        .orderBy(asc(visits.checkedInAt))
        .limit(1);

    if (!next) return;

    await tx.update(visits).set({ inChairAt: now }).where(eq(visits.id, next.visitId));
}

export const visitService = {
    async checkIn(input: CheckInInput, executor?: Executor): Promise<VisitRow> {
        const run = async (tx: Executor): Promise<VisitRow> => {
            const [appointment] = await tx
                .select()
                .from(appointments)
                .where(eq(appointments.id, input.appointmentId))
                .limit(1);

            if (!appointment) throw AppError.notFound('appointment');

            if (!canTransition(appointment.status, 'checked_in')) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    `cannot check in an appointment that is ${appointment.status}`,
                    422,
                );
            }

            const now = new Date();
            const today = clinicDayOf(now, input.offsetMinutes);

            if (
                appointment.channel !== 'walk_in' &&
                (appointment.startsAt < today.from || appointment.startsAt >= today.to)
            ) {
                throw new AppError(
                    ERROR_CODE.CHECK_IN_NOT_TODAY,
                    "cannot check in an appointment that is not on today's clinic day",
                    422,
                );
            }

            const waiting = await chairIsTaken(tx, appointment.branchId, today);

            let visit: VisitRow | undefined;
            try {
                [visit] = await tx
                    .insert(visits)
                    .values({
                        id: Bun.randomUUIDv7(),
                        appointmentId: appointment.id,
                        checkedInAt: now,
                        inChairAt: waiting ? null : now,
                    })
                    .returning();
            } catch (err) {
                if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
                    throw new AppError(
                        ERROR_CODE.VISIT_ALREADY_EXISTS,
                        'this appointment already has a visit',
                        409,
                        { cause: err },
                    );
                }
                throw err;
            }

            if (!visit) throw AppError.internal('visit insert returned nothing');

            await tx
                .update(appointments)
                .set({ status: 'checked_in', updatedAt: now })
                .where(eq(appointments.id, appointment.id));

            const planned = await tx
                .select({
                    procedureId: appointmentProcedures.procedureId,
                    quantity: appointmentProcedures.quantity,
                    tooth: appointmentProcedures.tooth,
                    note: appointmentProcedures.note,
                    quotedPrice: appointmentProcedures.quotedPrice,
                    defaultPrice: procedureTypes.defaultPrice,
                    cost: procedureTypes.cost,
                })
                .from(appointmentProcedures)
                .innerJoin(procedureTypes, eq(appointmentProcedures.procedureId, procedureTypes.id))
                .where(eq(appointmentProcedures.appointmentId, appointment.id))
                .orderBy(asc(appointmentProcedures.sortOrder));

            if (planned.length > 0) {
                await tx.insert(visitProcedures).values(
                    planned.map((line) => ({
                        id: Bun.randomUUIDv7(),
                        visitId: visit.id,
                        procedureId: line.procedureId,
                        quantity: line.quantity,
                        unitPrice: line.quotedPrice ?? line.defaultPrice,
                        unitCost: line.cost,
                        tooth: line.tooth,
                        note: line.note,
                    })),
                );
            }

            const computedTotal = await recompute(tx, visit.id);
            const [priced] = await tx
                .update(visits)
                .set({ chargedTotal: computedTotal })
                .where(eq(visits.id, visit.id))
                .returning();

            return priced ?? visit;
        };

        const visit = executor ? await run(executor) : await db.transaction(run);

        broadcast(WS_EVENT.VISIT_UPDATED, { id: visit.id });
        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id: visit.appointmentId });
        if (!executor) broadcast(WS_EVENT.APPOINTMENT_CHECKED_IN, { id: visit.appointmentId });
        return visit;
    },

    async pendingNextProcedures(patientId: string): Promise<NextProcedure[]> {
        return pendingNext(db, patientId);
    },

    async pendingNext(patientId: string): Promise<NextProcedure | null> {
        return (await pendingNext(db, patientId))[0] ?? null;
    },

    async byId(id: string, viewer?: Viewer): Promise<Visit> {
        const visit = await requireVisit(db, id);

        const lines = await db
            .select({
                id: visitProcedures.id,
                procedureId: visitProcedures.procedureId,
                name: procedureTypes.name,
                quantity: visitProcedures.quantity,
                unitPrice: visitProcedures.unitPrice,
                isCheckup: procedureTypes.isCheckup,
                tooth: visitProcedures.tooth,
                note: visitProcedures.note,
            })
            .from(visitProcedures)
            .innerJoin(procedureTypes, eq(visitProcedures.procedureId, procedureTypes.id))
            .where(eq(visitProcedures.visitId, id));

        const paymentRows = await db
            .select({
                id: payments.id,
                amount: payments.amount,
                method: payments.method,
                methodNote: payments.methodNote,
                paidAt: payments.paidAt,
            })
            .from(payments)
            .where(eq(payments.visitId, id));

        const nextProcedures = await nextOf(db, id);
        const nextAppointmentId = await takenBy(db, visit.nextAppointmentId);

        const paidTotal = paymentRows.reduce((sum, p) => sum + p.amount, 0);
        const shown = viewer === undefined || seesPayments(viewer);
        const priced = shown || visit.completedAt === null;

        return {
            ...visit,
            chargedTotal: priced ? visit.chargedTotal : null,
            computedTotal: priced ? visit.computedTotal : null,
            procedures: lines.map((l) =>
                priced
                    ? { ...l, lineTotal: l.unitPrice * l.quantity }
                    : { ...l, unitPrice: null, lineTotal: null },
            ),
            nextAppointmentId,
            nextProcedures,
            nextProcedure: nextProcedures[0]
                ? { ...nextProcedures[0], appointmentId: nextAppointmentId }
                : null,
            payments: shown ? paymentRows : null,
            paidTotal: shown ? paidTotal : null,
            balance: shown ? visit.chargedTotal - paidTotal : null,
        };
    },

    async setProcedures(input: SetProceduresInput, viewer?: Viewer): Promise<Visit> {
        const lines = await resolveProcedureLines(input.procedures);
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
                : (await resolveProcedureLines(asked.map((line) => ({ ...line, quantity: 1 })))).map(
                      (line) => ({
                          procedureId: line.procedure.id,
                          tooth: line.tooth,
                      }),
                  );

        const resolved = lines.map((line, i) => ({
            procedureId: line.procedure.id,
            quantity: line.quantity,
            unitPrice: input.procedures[i]?.unitPrice ?? line.procedure.defaultPrice,
            unitCost: line.procedure.cost,
            tooth: line.tooth,
            note: line.note,
        }));

        const booked = await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);
            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            const before = await tx
                .select({ procedureId: visitProcedures.procedureId, unitCost: visitProcedures.unitCost })
                .from(visitProcedures)
                .where(eq(visitProcedures.visitId, visit.id));
            const savedCost = new Map(before.map((line) => [line.procedureId, line.unitCost]));

            await tx.delete(visitProcedures).where(eq(visitProcedures.visitId, visit.id));

            if (resolved.length > 0) {
                await tx.insert(visitProcedures).values(
                    resolved.map((line) => ({
                        id: Bun.randomUUIDv7(),
                        visitId: visit.id,
                        ...line,
                        unitCost: savedCost.get(line.procedureId) ?? line.unitCost,
                    })),
                );
            }

            const computedTotal = await recompute(tx, visit.id);

            if (!visit.pricedAt) {
                await tx.update(visits).set({ chargedTotal: computedTotal }).where(eq(visits.id, visit.id));
            }

            return next === undefined ? null : setNext(tx, visit, next, new Date());
        });

        if (booked) broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id: booked });
        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId, viewer);
    },

    async setPrice(input: SetPriceInput, viewer?: Viewer): Promise<Visit> {
        const row = await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            const [updated] = await tx
                .update(visits)
                .set({ chargedTotal: input.chargedTotal, pricedAt: new Date() })
                .where(eq(visits.id, visit.id))
                .returning();

            if (!updated) throw AppError.notFound('visit');
            return updated;
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: row.id });
        return this.byId(row.id, viewer);
    },

    async checkOut(input: CheckOutInput, viewer?: Viewer): Promise<Visit> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            const [appointment] = await tx
                .select()
                .from(appointments)
                .where(eq(appointments.id, visit.appointmentId))
                .limit(1);

            if (!appointment) throw AppError.notFound('appointment');

            const reclosing = appointment.status === 'done';

            if (!reclosing && !canTransition(appointment.status, 'done')) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    `cannot check out an appointment that is ${appointment.status}`,
                    422,
                );
            }

            if (!appointment.isOpeningBalance) {
                const [line] = await tx
                    .select({ id: visitProcedures.id })
                    .from(visitProcedures)
                    .where(eq(visitProcedures.visitId, visit.id))
                    .limit(1);
                if (!line) {
                    throw new AppError(
                        ERROR_CODE.VISIT_HAS_NO_PROCEDURES,
                        'cannot check out a visit with no procedures',
                        422,
                    );
                }
            }

            const now = new Date();

            await tx
                .update(visits)
                .set({
                    chargedTotal: input.chargedTotal,
                    pricedAt: visit.pricedAt ?? now,
                    completedAt: now,
                })
                .where(eq(visits.id, visit.id));

            const paidTotal = input.paidTotal ?? 0;
            if (paidTotal > 0) {
                const [taken] = await tx
                    .select({ paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
                    .from(payments)
                    .where(eq(payments.visitId, visit.id));
                if (paidTotal > input.chargedTotal - (taken?.paid ?? 0)) {
                    throw new AppError(
                        ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
                        'the payment is more than is owed on this visit',
                        422,
                    );
                }
                await insertPayment(tx, visit.id, paidTotal, input.method, input.methodNote ?? null);
            }

            if (!reclosing) {
                await tx
                    .update(appointments)
                    .set({ status: 'done', updatedAt: now })
                    .where(eq(appointments.id, appointment.id));

                if (appointment.status === 'checked_in') {
                    await seatNextInChair(
                        tx,
                        appointment.branchId,
                        clinicDayOf(appointment.startsAt, input.offsetMinutes),
                        now,
                    );
                }
            }
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId, viewer);
    },

    async setPaid(input: SetPaidInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            const [visit] = await tx
                .select()
                .from(visits)
                .where(eq(visits.id, input.visitId))
                .limit(1)
                .for('update');
            if (!visit) throw AppError.notFound('visit');

            const [collected] = await tx
                .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
                .from(payments)
                .where(eq(payments.visitId, visit.id));

            const delta = input.paidTotal - (collected?.total ?? 0);
            if (delta === 0) return;

            if (delta > 0 && input.paidTotal > visit.chargedTotal) {
                throw new AppError(
                    ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
                    'the paid total is more than this visit charges',
                    422,
                );
            }

            await insertPayment(tx, visit.id, delta, input.method, input.methodNote ?? null);
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    async setPaidMethod(input: SetPaidMethodInput): Promise<Visit> {
        const methodNote = input.method === 'other' ? (input.methodNote?.trim() ?? null) : null;

        await db.transaction(async (tx) => {
            const [visit] = await tx
                .select({ id: visits.id })
                .from(visits)
                .where(eq(visits.id, input.visitId))
                .limit(1)
                .for('update');
            if (!visit) throw AppError.notFound('visit');

            const rows = await tx
                .select({ amount: payments.amount, method: payments.method, methodNote: payments.methodNote })
                .from(payments)
                .where(eq(payments.visitId, visit.id));

            for (const row of restated(rows, input.method, methodNote)) {
                await insertPayment(tx, visit.id, row.amount, row.method, row.methodNote);
            }
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    async recordPayment(input: RecordPaymentInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);
            await insertPayment(tx, visit.id, input.amount, input.method, input.methodNote ?? null);
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId);
    },

    async reopen(input: ReopenInput, viewer?: Viewer): Promise<Visit> {
        if (viewer !== undefined && !seesPayments(viewer)) {
            throw new AppError(ERROR_CODE.ROLE_FORBIDDEN, 'this role may not reopen a finished visit', 403);
        }
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            if (!visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    'this visit is not checked out',
                    422,
                );
            }

            await tx.update(visits).set({ completedAt: null, pricedAt: null }).where(eq(visits.id, visit.id));
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
        return this.byId(input.visitId, viewer);
    },

    async delete(input: DeleteVisitInput): Promise<void> {
        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);

            const [paid] = await tx
                .select({ id: payments.id })
                .from(payments)
                .where(eq(payments.visitId, visit.id))
                .limit(1);
            if (paid) {
                throw new AppError(ERROR_CODE.HAS_PAYMENTS, 'this visit has payments recorded on it', 409);
            }

            const [appointment] = await tx
                .select()
                .from(appointments)
                .where(eq(appointments.id, visit.appointmentId))
                .limit(1);
            if (!appointment) throw AppError.notFound('appointment');

            await tx.delete(visits).where(eq(visits.id, visit.id));

            const now = new Date();
            if (appointment.channel === 'walk_in' || appointment.isOpeningBalance) {
                await tx.delete(reminders).where(eq(reminders.appointmentId, appointment.id));
                await tx.delete(appointments).where(eq(appointments.id, appointment.id));
            } else {
                await tx
                    .update(appointments)
                    .set({ status: 'booked', updatedAt: now })
                    .where(eq(appointments.id, appointment.id));
            }

            if (appointment.status === 'checked_in' && visit.inChairAt) {
                await seatNextInChair(
                    tx,
                    appointment.branchId,
                    clinicDayOf(appointment.startsAt, input.offsetMinutes),
                    now,
                );
            }
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: input.visitId });
    },

    async deletePayment(input: DeletePaymentInput): Promise<Visit> {
        const [row] = await db.delete(payments).where(eq(payments.id, input.paymentId)).returning();
        if (!row) throw AppError.notFound('payment');

        broadcast(WS_EVENT.VISIT_UPDATED, { id: row.visitId });
        return this.byId(row.visitId);
    },

    async byAppointment(appointmentId: string): Promise<VisitRow | null> {
        const [row] = await db.select().from(visits).where(eq(visits.appointmentId, appointmentId)).limit(1);
        return row ?? null;
    },
};

type Method = RecordPaymentInput['method'];

interface PaymentLine {
    amount: number;
    method: Method;
    methodNote: string | null;
}

function restated(rows: readonly PaymentLine[], method: Method, methodNote: string | null): PaymentLine[] {
    const keyOf = (m: Method, note: string | null) => (m === 'other' ? `other:${note?.trim() ?? ''}` : m);
    const target = keyOf(method, methodNote);

    const nets = new Map<string, PaymentLine>();
    for (const row of rows) {
        const key = keyOf(row.method, row.methodNote);
        const net = nets.get(key);
        if (net) net.amount += row.amount;
        else nets.set(key, { ...row });
    }

    const out: PaymentLine[] = [];
    let moved = 0;
    for (const [key, net] of nets) {
        if (key === target || net.amount === 0) continue;
        out.push({ amount: -net.amount, method: net.method, methodNote: net.methodNote });
        moved += net.amount;
    }
    if (moved !== 0) out.push({ amount: moved, method, methodNote });
    return out;
}

export async function insertPayment(
    executor: Executor,
    visitId: string,
    amount: number,
    method: RecordPaymentInput['method'],
    methodNote: string | null,
): Promise<void> {
    try {
        await executor.insert(payments).values({
            id: Bun.randomUUIDv7(),
            visitId,
            amount,
            method,
            methodNote,
        });
    } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.CHECK_VIOLATION) {
            throw method === 'other'
                ? new AppError(ERROR_CODE.PAYMENT_NOTE_REQUIRED, "method 'other' requires a note", 422, {
                      cause: err,
                  })
                : new AppError(ERROR_CODE.INVALID_AMOUNT, 'payment amount is out of range', 422, {
                      cause: err,
                  });
        }
        throw err;
    }
}
