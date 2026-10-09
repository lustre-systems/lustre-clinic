/**
 * SPEC §8, §9. A visit is what happened, as opposed to what was scheduled.
 *
 * Check-in creates it and seeds its lines: one per procedure the booking
 * planned (§7), each priced at the price the desk quoted if it quoted one, else
 * at the catalogue price on the day rather than at booking, and nothing else.
 * The checkup is not added for them: a consultation
 * is a line someone picks, like any other, and one on every visit buried what
 * the bookings were actually for. Pricing is not a prerequisite for
 * checkout: `setProcedures` and `setPrice` are optional, may be called in any
 * order, and procedure detail is often entered after the patient has left.
 *
 * The §5 rules the lines obey — selectable leaf, tooth required or not
 * applicable, quantity, uniqueness per tooth — live in `procedure.rules.ts`,
 * shared with booking so the two cannot drift. The charged total tracks the
 * computed one until someone edits it, and `priced_at` records that they did;
 * both are frozen at checkout, when the balance the patient owes is settled.
 * Checkout closes either `checked_in` (the chair) or `awaiting_payment` (the
 * desk), and zero paid is a valid checkout — the balance is derived (§10).
 */
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
    /** Null, with `lineTotal`, where the visit's amounts are withheld (see `Visit`). */
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

/**
 * The three payment fields are null for a viewer who may not see payments (a
 * doctor): withheld, not zero, so no screen can mistake one for "nothing paid".
 * A finished visit's amounts go the same way for that viewer — what it cost is
 * the patient's money too. A visit still open keeps its prices: the doctor
 * prices and checks it out.
 */
interface Visit extends Omit<VisitRow, 'chargedTotal' | 'computedTotal'> {
    chargedTotal: number | null;
    computedTotal: number | null;
    procedures: VisitLine[];
    payments: VisitPayment[] | null;
    paidTotal: number | null;
    balance: number | null;
}

/**
 * Who a returned visit is for. Omitted by callers inside the server, which see
 * everything; a router passes the caller's role.
 */
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

/**
 * Whoever is in the chair at this branch right now, if anyone.
 *
 * "In the chair" is a stamp, not a position in a queue: `in_chair_at` set and
 * the appointment still `checked_in`. Once they go to the desk or are checked
 * out the status moves on and the chair reads empty again, which is what makes
 * this safe to ask before seating someone.
 *
 * Asked of one clinic day. A patient nobody checked out yesterday is still
 * `checked_in`, and without the bound they held the chair on every day after.
 */
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

/**
 * Move the longest-waiting patient into the chair the moment it empties.
 *
 * Called from both ways out of the chair — to the desk (`awaitPayment`) and
 * straight to checkout — because the patient who has been waiting since 08:24
 * did not begin their visit when they arrived, they began it when the person
 * ahead of them got up. That is the whole reason `in_chair_at` exists: the bar
 * on the day view measures from here, and measuring from `checked_in_at`
 * charged the second patient of the morning with the first one's visit.
 *
 * Longest wait wins, which is the same order the day view queues people in, so
 * the screen and the stamp cannot name different patients. Nobody waiting is
 * the ordinary case and does nothing — the next arrival seats themselves.
 *
 * The queue is the day of the appointment leaving the chair. A patient left
 * checked in on an earlier day has waited longest by the clock, and is not here.
 */
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

            // A patient is checked in on the day they are booked for. Anywhere
            // else it is a tap on another day's list, and the visit it made
            // would sit checked in on that day with nobody there to close it.
            // A walk-in is checked in by the call that creates it, with the
            // patient at the desk, and a queue running past midnight can start
            // it on the next clinic day — so it is never a mis-tap.
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

            // Walking into an empty chair is the common case at a quiet clinic,
            // and it is the one where arriving and being seated are the same
            // moment. With someone already in it this patient is queueing, and
            // `in_chair_at` stays null until they get up.
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
        // Inside a caller's transaction (a walk-in) nothing is committed yet,
        // and the doctor's phone asks for the name the moment it hears this.
        // The caller announces the arrival once it has committed.
        if (!executor) broadcast(WS_EVENT.APPOINTMENT_CHECKED_IN, { id: visit.appointmentId });
        return visit;
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

        const paidTotal = paymentRows.reduce((sum, p) => sum + p.amount, 0);
        const shown = viewer === undefined || seesPayments(viewer);
        // Priced for the doctor until checkout: a patient sent to the desk can
        // still be checked out from his phone.
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
            payments: shown ? paymentRows : null,
            paidTotal: shown ? paidTotal : null,
            balance: shown ? visit.chargedTotal - paidTotal : null,
        };
    },

    async setProcedures(input: SetProceduresInput, viewer?: Viewer): Promise<Visit> {
        const lines = await resolveProcedureLines(input.procedures);

        const resolved = lines.map((line, i) => ({
            procedureId: line.procedure.id,
            quantity: line.quantity,
            unitPrice: input.procedures[i]?.unitPrice ?? line.procedure.defaultPrice,
            tooth: line.tooth,
            note: line.note,
        }));

        await db.transaction(async (tx) => {
            const visit = await requireVisit(tx, input.visitId);
            if (visit.completedAt) {
                throw new AppError(
                    ERROR_CODE.VISIT_ALREADY_COMPLETED,
                    'this visit is already checked out',
                    409,
                );
            }

            await tx.delete(visitProcedures).where(eq(visitProcedures.visitId, visit.id));

            if (resolved.length > 0) {
                await tx.insert(visitProcedures).values(
                    resolved.map((line) => ({
                        id: Bun.randomUUIDv7(),
                        visitId: visit.id,
                        ...line,
                    })),
                );
            }

            const computedTotal = await recompute(tx, visit.id);

            if (!visit.pricedAt) {
                await tx.update(visits).set({ chargedTotal: computedTotal }).where(eq(visits.id, visit.id));
            }
        });

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

            // Closing a visit that was reopened to be corrected: the
            // appointment never left `done` (see `reopen`), so there is no
            // transition to make and none to check. The guard above is what
            // stops this being a double checkout — a visit that is still
            // closed is refused before we get here.
            const reclosing = appointment.status === 'done';

            if (!reclosing && !canTransition(appointment.status, 'done')) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    `cannot check out an appointment that is ${appointment.status}`,
                    422,
                );
            }

            // Check-in adds nothing of its own, so a visit can reach checkout
            // empty, and closing one would bill for work nobody recorded. The
            // list may be empty until now. An opening balance is the one visit
            // that never has lines: it stands for debt, not for a sitting.
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
                // The desk's phone clamps to what is owed; a doctor's is not
                // shown what was already paid and cannot, so the rule is here.
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

                // Checking out straight from the chair empties it. Reclosing a
                // corrected visit does not — that patient left long ago, and
                // seating someone off it would restart a bar that is already
                // running.
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

    /**
     * Correct what a visit was paid, in total — the only way a recorded payment
     * comes back down. `800 collected` on a visit that took 500 is corrected by
     * saying 500, not by asking for a refund of 300.
     *
     * What is written is the difference, as a payment row of its own: a refund
     * is a negative payment, dated the day the correction was made. Nothing is
     * edited and nothing is deleted, because the 800 row is still a true record
     * of what was entered at the time, and the readers all sum the column
     * (`stats`, `balance`), so the money lands in the right place on its own.
     *
     * Saying what is already on the visit writes nothing at all.
     *
     * Raising the total past the charge is refused, as at checkout (§7.6): the
     * phone clamps, so only a stale or hand-made call meets this. Lowering is
     * never refused, even while still above the charge — that is a visit whose
     * charge came down after it was paid, and the correction is the refund.
     */
    async setPaid(input: SetPaidInput): Promise<Visit> {
        await db.transaction(async (tx) => {
            // Locked so two phones correcting the same visit cannot both
            // measure against the same total and write two deltas.
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

    /**
     * Say again how the money on a visit was paid — "that was card, not cash" —
     * without changing how much. Each other method's net on the visit is given
     * back in that method and taken again in `method`, as rows of their own and
     * dated today, so the takings by method come out right and nothing that was
     * entered is edited away. `other` is told apart by its note.
     *
     * Already all in `method`, it writes nothing.
     */
    async setPaidMethod(input: SetPaidMethodInput): Promise<Visit> {
        const methodNote = input.method === 'other' ? (input.methodNote?.trim() ?? null) : null;

        await db.transaction(async (tx) => {
            // Locked as in `setPaid`: two phones restating the same visit must
            // not both move the same money.
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

    /**
     * Unlock a finished visit so it can be corrected — the wrong tooth charged,
     * a procedure left off.
     *
     * The *appointment* is not touched. It stays `done`, because it is: the
     * patient came, was seen and went home, and someone fixing the paperwork
     * three weeks later does not undo that. Moving it back to
     * `awaiting_payment` — which is what this did — put the patient back on the
     * day view as though they were standing at the desk waiting to pay, and an
     * edit that was opened and backed out of left them there for good.
     *
     * So `completedAt` on the visit is the only thing that says "closed", and
     * clearing it is the whole of reopening. `pricedAt` goes with it: checkout
     * stamps it, and leaving it set would pin `chargedTotal` while
     * `setProcedures` recomputed around it — the lines would change and the
     * bill would not.
     *
     * Payments already taken are untouched. The money was handed over and the
     * receipt is a fact; the visit reopens owing whatever is left after them,
     * which is what `amountDue` already reads.
     */
    async reopen(input: ReopenInput, viewer?: Viewer): Promise<Visit> {
        // Reopening puts a finished visit's amounts back in front of whoever
        // reopened it, and a doctor is not shown those.
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

    /**
     * Undo a check-in that should not have happened — the wrong row tapped,
     * a patient who never came. The visit and its lines go; the appointment
     * goes back to `booked` so the record still says they were expected, and
     * the desk can cancel or no-show it from there. A walk-in and an opening
     * balance have no booking to go back to — the appointment was made for the
     * visit — so they go with it.
     *
     * Refused while a payment is on it. Money handed over is a fact about the
     * drawer, and a delete that took it along would move a past day's takings
     * without a trace; the payments are deleted first, one by one, if they too
     * were a mistake. The chair is handed on if this visit held it, the same
     * as at checkout.
     */
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

    /**
     * Remove one payment row that was entered by mistake. This is the one
     * place a payment is deleted rather than corrected: `setPaid` writes the
     * difference and keeps both rows, which is right for "800 was really 500"
     * and wrong for "that was never taken at all".
     */
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

/**
 * The rows that move every other method's net onto `method`: one giving each
 * back, then one taking the lot again. Their sum is zero, so the paid total
 * does not move.
 */
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

/**
 * The one place a `payments` row is written. Exported because `balance.settle`
 * allocates a patient-level payment across several visits and each slice is an
 * ordinary payment row — sharing this is what keeps the two check-violation
 * cases mapping to the same `ERROR_CODE` from both entry points.
 */
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
