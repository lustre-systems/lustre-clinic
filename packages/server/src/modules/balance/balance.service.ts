/**
 * SPEC §10:
 *
 *     balance = visits.charged_total - COALESCE(SUM(payments.amount), 0)
 *
 * Derived, never stored. There is no unpaid status — a payment is a row, not a
 * state transition — so every figure here is computed at read time.
 *
 * In `summary`, charged is attributed to the visit's appointment date while
 * collected is attributed to the day the money arrived, which is why the two
 * are counted separately rather than differenced per visit. `to` is inclusive
 * as a date, so the range ends at the start of the following day.
 *
 * `outstanding` and `byPatient` count opening balances — money carried over
 * from the old system is still owed, and a patient's total has to say so.
 * `summary` does not: see the note on its charged query.
 *
 * `settle` is the one write here, and the only way a payment is taken in the
 * app. It is against a *patient*: the money is allocated over their unsettled
 * visits oldest-first and written as ordinary `payments` rows, so every read
 * above keeps working unchanged and no balance is ever stored.
 */
import { ERROR_CODE, type PaymentMethod, WS_EVENT } from '@lustre/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { appointments, patients, payments, visits } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { ageFromBirthDate, dayRange } from '../../util/time.ts';
import { broadcast } from '../../ws/index.ts';
import { insertPayment } from '../visit/visit.service.ts';
import type { BalanceSummaryInput, BalanceTakingsInput, SettleInput } from './balance.schema.ts';

interface PatientBalance {
    patientId: string;
    name: string;
    phone: string;
    /** What the Patients list's rows show under the name, so a debtor reads the same as anyone else. */
    age: number | null;
    gender: string | null;
    balance: number;
    oldestUnpaidAt: Date;
}

interface OutstandingReport {
    total: number;
    patients: PatientBalance[];
}

interface VisitBalance {
    visitId: string;
    appointmentId: string;
    ref: string;
    startsAt: Date;
    chargedTotal: number;
    paidTotal: number;
    balance: number;
}

interface BalanceSummary {
    charged: number;
    collected: number;
    difference: number;
    /** Distinct patients carrying a balance on a visit charged inside the range. */
    duePatients: number;
    /**
     * The part of `collected` that paid for work charged before the range
     * started. A real join of payment date against visit date — emphatically
     * not `collected - charged`, which is only the period's net position and
     * goes negative for reasons that have nothing to do with old visits.
     */
    olderCollected: number;
    /** Distinct visits that `olderCollected` arrived against. */
    olderVisits: number;
}

/** One visit's share of a patient-level payment, in the order it was filled. */
interface SettledVisit {
    visitId: string;
    ref: string;
    startsAt: Date;
    /** What the visit owed before this payment reached it. */
    outstandingBefore: number;
    /** The slice allocated here. Always positive — an untouched visit is absent. */
    amount: number;
    outstandingAfter: number;
    /** `outstandingAfter === 0` — the visit is fully paid off, not merely reduced. */
    settled: boolean;
}

/**
 * What `settle` did, per visit.
 *
 * The server says where the money went whether or not a screen prints it. The
 * client currently reads the refs out in its confirmation and is due to stop —
 * the clinic's paper file is one page per patient, so the split is bookkeeping
 * the desk never posts. That is a UI decision; this payload stays, because a
 * receipt, an audit and any future per-visit view all need it.
 */
interface SettleReport {
    patientId: string;
    amount: number;
    method: PaymentMethod;
    outstandingBefore: number;
    outstandingAfter: number;
    visits: SettledVisit[];
}

interface MethodTaking {
    method: PaymentMethod;
    amount: number;
    count: number;
}

interface TakingsReport {
    total: number;
    byMethod: MethodTaking[];
}

/**
 * Every money SUM here is `::bigint`, never `::int`.
 *
 * `payments.amount` and `visits.charged_total` are `integer`, so a sum of them
 * overflows int4 at 2^31−1 piastres — about 21.5M EGP. That is a lifetime of
 * takings for a clinic, not an impossible number, and "All time" on the
 * dashboard aggregates the whole table on every visit to it. Postgres does not
 * saturate: the cast raises `integer out of range`, which would take the
 * dashboard out permanently, at the point the clinic has been most successful.
 *
 * A bigint reaches the driver as a string, because a bigint does not fit a JS
 * number in general. These do: `Number.MAX_SAFE_INTEGER` piastres is ninety
 * trillion pounds, and piastres are already carried as numbers everywhere else.
 */
function piastres(total: string | number | null): number {
    return total === null ? 0 : Number(total);
}

/**
 * The two instants a range means. Each end is expanded with the offset in force
 * on *its own* day: a range that crosses a DST changeover has two, and using
 * today's for both opens the window an hour off at the far end. These queries
 * compare a timestamp against the boundary, so that hour changes the answer —
 * every "This year" read during Egypt's summer would otherwise count the last
 * hour of 31 December.
 */
function rangeOf(input: { from: string; to: string; offsetMinutes: number; fromOffsetMinutes?: number }) {
    const { from } = dayRange(input.from, input.fromOffsetMinutes ?? input.offsetMinutes);
    const { to } = dayRange(input.to, input.offsetMinutes);
    return { from, to };
}

function paidPerVisit() {
    return db
        .select({
            visitId: payments.visitId,
            paidTotal: sql<string>`SUM(${payments.amount})::bigint`.as('paid_total'),
        })
        .from(payments)
        .groupBy(payments.visitId)
        .as('paid');
}

/**
 * A patient's visits that still owe something, oldest first. One query behind
 * both `byPatient` — what the record draws — and `settle`'s allocation, so the
 * list a payment is spread over cannot mean something different from the list
 * that was shown.
 *
 * The `ref` tiebreak is not cosmetic: two visits can share a `starts_at`, and an
 * allocation that filled them in whichever order Postgres returned would put the
 * partial on a different visit between two runs of the same payment. `ref` is
 * unique, so the order is total.
 */
function unsettledVisits(executor: Executor, patientId: string): Promise<VisitBalance[]> {
    const paid = paidPerVisit();

    return executor
        .select({
            visitId: visits.id,
            appointmentId: appointments.id,
            ref: appointments.ref,
            startsAt: appointments.startsAt,
            chargedTotal: visits.chargedTotal,
            paidTotal: sql<string>`COALESCE(${paid.paidTotal}, 0)::bigint`,
        })
        .from(visits)
        .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
        .leftJoin(paid, eq(paid.visitId, visits.id))
        .where(
            and(
                eq(appointments.patientId, patientId),
                sql`${visits.chargedTotal} - COALESCE(${paid.paidTotal}, 0) > 0`,
            ),
        )
        .orderBy(asc(appointments.startsAt), asc(appointments.ref))
        .then((rows) =>
            rows.map((row) => {
                const paidTotal = piastres(row.paidTotal);
                return { ...row, paidTotal, balance: row.chargedTotal - paidTotal };
            }),
        );
}

export const balanceService = {
    async outstanding(patientIds?: string[]): Promise<OutstandingReport> {
        if (patientIds?.length === 0) return { total: 0, patients: [] };

        const paid = paidPerVisit();
        const balance = sql<string>`SUM(${visits.chargedTotal} - COALESCE(${paid.paidTotal}, 0))::bigint`;

        const rows = await db
            .select({
                patientId: patients.id,
                name: patients.name,
                phone: patients.phone,
                birthDate: patients.birthDate,
                gender: patients.gender,
                balance,
                oldestUnpaidAt: sql<Date>`MIN(${appointments.startsAt})`,
            })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .innerJoin(patients, eq(appointments.patientId, patients.id))
            .leftJoin(paid, eq(paid.visitId, visits.id))
            .where(patientIds ? inArray(patients.id, patientIds) : undefined)
            .groupBy(patients.id, patients.name, patients.phone, patients.birthDate, patients.gender)
            .having(sql`SUM(${visits.chargedTotal} - COALESCE(${paid.paidTotal}, 0)) > 0`)
            .orderBy(desc(balance));

        const owing = rows.map((row) => ({
            patientId: row.patientId,
            name: row.name,
            phone: row.phone,
            age: ageFromBirthDate(row.birthDate),
            gender: row.gender,
            balance: piastres(row.balance),
            oldestUnpaidAt: new Date(row.oldestUnpaidAt),
        }));

        return { total: owing.reduce((sum, row) => sum + row.balance, 0), patients: owing };
    },

    byPatient(patientId: string): Promise<VisitBalance[]> {
        return unsettledVisits(db, patientId);
    },

    /**
     * One payment against a patient, spread over their unsettled visits.
     *
     * **Oldest debt first.** Each visit is filled to what it owes, in visit-date
     * order, until the money runs out; the last visit touched usually takes a
     * partial. That is what a desk means by paying off a balance, and it is the
     * arithmetic the server can do instead of asking someone to pick a visit and
     * do it in their head.
     *
     * **One transaction, or nothing.** Three inserts of which the second fails
     * leaves the patient having handed over 6,000 with 5,850 recorded — and the
     * 5,850 is the figure the desk reads back to them. Allocate and insert
     * inside one `db.transaction`, so a failure anywhere leaves every balance
     * byte-identical. This is `procedure.reorder`'s rule with money in place of
     * sort order.
     *
     * **Two phones must not both allocate against the same visit.** Outstanding
     * is derived, so reading it does not lock anything on its own: the row lock
     * is taken first, in a statement of its own, over every one of the patient's
     * visits. The second settle blocks there, and its *next* statement — under
     * READ COMMITTED, a fresh snapshot — reads the outstanding the winner left
     * behind rather than the one it started from.
     *
     * Opening balances are allocated against like any other debt. `outstanding`
     * and `byPatient` both count them (money carried over from the old system is
     * still owed), they are the oldest debt a patient has, and a payment against
     * one is the case `summary.olderCollected` was written for.
     *
     * Each slice is an ordinary `payments` row against its visit, so
     * `balance.summary`, `takings` and `olderCollected` pick them up without
     * learning a new concept. There is no patient-level payments table and no
     * credit balance: §10's balances are derived, and both would be state.
     */
    async settle(input: SettleInput): Promise<SettleReport> {
        const report = await db.transaction(async (tx) => {
            // A statement of its own, and before anything is read: `FOR UPDATE`
            // is what a competing settle blocks on, and the read that decides
            // the allocation has to happen after that block clears.
            await tx
                .select({ id: visits.id })
                .from(visits)
                .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
                .where(eq(appointments.patientId, input.patientId))
                .orderBy(asc(visits.id))
                .for('update', { of: visits });

            const unsettled = await unsettledVisits(tx, input.patientId);
            const outstandingBefore = unsettled.reduce((total, visit) => total + visit.balance, 0);

            if (outstandingBefore <= 0) {
                throw new AppError(
                    ERROR_CODE.NOTHING_OUTSTANDING,
                    'this patient has nothing outstanding',
                    422,
                );
            }

            // Refused rather than parked. A credit balance is a concept §10 does
            // not have, and inventing one here would make a balance something
            // other than charges minus payments.
            if (input.amount > outstandingBefore) {
                throw new AppError(
                    ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
                    'a payment may not exceed what the patient owes',
                    422,
                );
            }

            let remaining = input.amount;
            const allocated: SettledVisit[] = [];

            for (const visit of unsettled) {
                if (remaining <= 0) break;

                const amount = Math.min(remaining, visit.balance);
                remaining -= amount;

                allocated.push({
                    visitId: visit.visitId,
                    ref: visit.ref,
                    startsAt: visit.startsAt,
                    outstandingBefore: visit.balance,
                    amount,
                    outstandingAfter: visit.balance - amount,
                    settled: visit.balance === amount,
                });
            }

            for (const visit of allocated) {
                await insertPayment(tx, visit.visitId, visit.amount, input.method, input.methodNote ?? null);
            }

            return {
                patientId: input.patientId,
                amount: input.amount,
                method: input.method,
                outstandingBefore,
                outstandingAfter: outstandingBefore - input.amount,
                visits: allocated,
            };
        });

        // After the commit, and one per visit: the other phone's day view,
        // patient record and money dashboard all key off this event, and
        // announcing a payment the transaction went on to roll back would put a
        // figure on the other screen that never existed.
        for (const visit of report.visits) {
            broadcast(WS_EVENT.VISIT_UPDATED, { id: visit.visitId });
        }

        return report;
    },

    async summary(input: BalanceSummaryInput): Promise<BalanceSummary> {
        const { from, to } = rangeOf(input);

        // Charged is what this clinic billed in the period. An opening balance
        // was billed by the old system before the cutoff, so it is excluded
        // here and left in `outstanding`, where it belongs — the patient owes
        // it either way, but nobody charged it on the day the row is dated.
        const [charged] = await db
            .select({ total: sql<string>`COALESCE(SUM(${visits.chargedTotal}), 0)::bigint` })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .where(
                and(
                    gte(appointments.startsAt, from),
                    lt(appointments.startsAt, to),
                    eq(appointments.isOpeningBalance, false),
                ),
            );

        const [collected] = await db
            .select({ total: sql<string>`COALESCE(SUM(${payments.amount}), 0)::bigint` })
            .from(payments)
            .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to)));

        const paid = paidPerVisit();

        // Who the period's shortfall is spread across, for the hero's
        // "· 12 patients". One patient with three unpaid visits is one patient,
        // hence the DISTINCT; opening balances are excluded for the same reason
        // they are excluded from `charged` above.
        const [due] = await db
            .select({ patients: sql<number>`COUNT(DISTINCT ${appointments.patientId})::int` })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .leftJoin(paid, eq(paid.visitId, visits.id))
            .where(
                and(
                    gte(appointments.startsAt, from),
                    lt(appointments.startsAt, to),
                    eq(appointments.isOpeningBalance, false),
                    sql`${visits.chargedTotal} - COALESCE(${paid.paidTotal}, 0) > 0`,
                ),
            );

        // Money that arrived in the range against a visit dated before it.
        // Opening balances belong here: they are the oldest debt there is, and
        // a payment against one is exactly this period settling older work.
        const [older] = await db
            .select({
                collected: sql<string>`COALESCE(SUM(${payments.amount}), 0)::bigint`,
                visitCount: sql<number>`COUNT(DISTINCT ${payments.visitId})::int`,
            })
            .from(payments)
            .innerJoin(visits, eq(payments.visitId, visits.id))
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to), lt(appointments.startsAt, from)));

        const chargedTotal = piastres(charged?.total ?? 0);
        const collectedTotal = piastres(collected?.total ?? 0);

        return {
            charged: chargedTotal,
            collected: collectedTotal,
            difference: chargedTotal - collectedTotal,
            duePatients: due?.patients ?? 0,
            olderCollected: piastres(older?.collected ?? 0),
            olderVisits: older?.visitCount ?? 0,
        };
    },

    /**
     * What was collected in the range, split by how it was paid. Attributed to
     * `paid_at` like `summary.collected`, so the two agree — the takings card
     * and the hero's "Collected" are the same money counted two ways.
     *
     * A method nobody used is absent rather than a zero row: the screen already
     * has a sentence for a period that collected nothing, and a 0% bar for
     * Instapay in a clinic that has never taken one is noise. Refunds are
     * negative payments (`0002_payment_corrections.sql`), so a method's total
     * can come out below zero, and that is the honest figure.
     */
    async takings(input: BalanceTakingsInput): Promise<TakingsReport> {
        const { from, to } = rangeOf(input);

        const amount = sql<string>`SUM(${payments.amount})::bigint`;

        const rows = await db
            .select({ method: payments.method, amount, count: sql<number>`COUNT(*)::int` })
            .from(payments)
            .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to)))
            .groupBy(payments.method)
            .orderBy(desc(amount));

        const byMethod = rows.map((row) => ({ ...row, amount: piastres(row.amount) }));

        return { total: byMethod.reduce((sum, row) => sum + row.amount, 0), byMethod };
    },
};
