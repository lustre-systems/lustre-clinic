/**
 * `server/src/modules/balance/balance.service.ts`:
 *
 *     balance = chargedTotal - Σ payments
 *
 * Derived, never stored. There is no unpaid status — a payment is a row, not a
 * state transition — so every figure here is computed at read time.
 *
 * In `summary`, charged is attributed to the visit's appointment date while
 * collected is attributed to the day the money arrived, which is why the two
 * are counted separately rather than differenced per visit.
 *
 * `outstanding` and `byPatient` count opening balances — money carried over
 * from the old system is still owed. `summary` and `stats` do not: nobody
 * billed it on the day the row is dated.
 */
import { ERROR_CODE, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, save } from '../db';
import { broadcast } from '../events';
import { assertAmount, DemoError, dayRange } from '../rules';
import type { Dated } from '../wire';
import { insertPayment } from './visit';

type OutstandingReport = Dated<RouterOutput['balance']['outstanding']>;
type VisitBalance = Dated<RouterOutput['balance']['byPatient'][number]>;
type BalanceSummary = Dated<RouterOutput['balance']['summary']>;
type TakingsReport = Dated<RouterOutput['balance']['takings']>;
type SettleReport = Dated<RouterOutput['balance']['settle']>;

function paidFor(visitId: string): number {
    return getDb()
        .payments.filter((payment) => payment.visitId === visitId)
        .reduce((sum, payment) => sum + payment.amount, 0);
}

/**
 * Each end of a range is expanded with the offset in force on *its own* day: a
 * range crossing a DST changeover has two, and using one for both opens the
 * window an hour off at the far end.
 */
export function rangeOf(input: {
    from: string;
    to: string;
    offsetMinutes?: number;
    fromOffsetMinutes?: number;
}): {
    from: Date;
    to: Date;
} {
    const offset = input.offsetMinutes ?? 0;
    const { from } = dayRange(input.from, input.fromOffsetMinutes ?? offset);
    const { to } = dayRange(input.to, offset);
    return { from, to };
}

/**
 * A patient's visits that still owe something, oldest first. One list behind
 * both `byPatient` — what the record draws — and `settle`'s allocation, so the
 * list a payment is spread over cannot mean something different from the list
 * that was shown. The `ref` tiebreak makes the order total: two visits can
 * share a `startsAt`, and the partial would otherwise land on a different visit
 * between two runs of the same payment.
 */
function unsettledVisits(patientId: string): VisitBalance[] {
    const db = getDb();

    return db.visits
        .map((visit) => {
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            if (!appointment || appointment.patientId !== patientId) return null;

            const paidTotal = paidFor(visit.id);
            const balance = visit.chargedTotal - paidTotal;
            if (balance <= 0) return null;

            return {
                visitId: visit.id,
                appointmentId: appointment.id,
                ref: appointment.ref,
                startsAt: appointment.startsAt,
                chargedTotal: visit.chargedTotal,
                paidTotal,
                balance,
            };
        })
        .filter((row): row is VisitBalance => row !== null)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.ref.localeCompare(b.ref));
}

export const balanceHandlers = {
    outstanding(input?: RouterInput['balance']['outstanding']): OutstandingReport {
        const db = getDb();
        const only = input?.patientIds ? new Set(input.patientIds) : null;
        const byPatient = new Map<string, { balance: number; oldestUnpaidAt: Date | null }>();

        for (const visit of db.visits) {
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            if (!appointment) continue;
            if (only && !only.has(appointment.patientId)) continue;

            const balance = visit.chargedTotal - paidFor(visit.id);
            const entry = byPatient.get(appointment.patientId) ?? { balance: 0, oldestUnpaidAt: null };

            entry.balance += balance;

            // Only an unpaid visit can be the oldest unpaid one. Dating the
            // debt from every visit puts it at a January that was settled, and
            // the money screen then presents it as older than it is —
            // `unsettledVisits` filters on the same rule before it orders.
            if (balance > 0 && (!entry.oldestUnpaidAt || appointment.startsAt < entry.oldestUnpaidAt)) {
                entry.oldestUnpaidAt = appointment.startsAt;
            }

            byPatient.set(appointment.patientId, entry);
        }

        const patients = [...byPatient.entries()]
            .filter(([, entry]) => entry.balance > 0)
            .map(([patientId, entry]) => {
                const patient = db.patients.find((row) => row.id === patientId);
                return {
                    patientId,
                    name: patient?.name ?? '',
                    phone: patient?.phone ?? '',
                    balance: entry.balance,
                    // A positive total cannot be reached without at least one
                    // unpaid visit, so the filter above has already settled this.
                    oldestUnpaidAt: entry.oldestUnpaidAt ?? new Date(),
                };
            })
            .sort((a, b) => b.balance - a.balance);

        return { total: patients.reduce((sum, row) => sum + row.balance, 0), patients };
    },

    byPatient(input: RouterInput['balance']['byPatient']): VisitBalance[] {
        return unsettledVisits(input.patientId);
    },

    /**
     * One payment against a patient, spread over their unsettled visits
     * oldest-first, each slice written as an ordinary payment row. That is what
     * a desk means by paying off a balance, and it is arithmetic the server can
     * do instead of asking someone to pick a visit and do it in their head.
     *
     * More than is owed is refused rather than parked: a credit balance is a
     * concept §10 does not have, and inventing one here would make a balance
     * something other than charges minus payments.
     */
    settle(input: RouterInput['balance']['settle']): SettleReport {
        const unsettled = unsettledVisits(input.patientId);
        const outstandingBefore = unsettled.reduce((total, visit) => total + visit.balance, 0);

        if (outstandingBefore <= 0) {
            throw new DemoError(ERROR_CODE.NOTHING_OUTSTANDING, 'this patient has nothing outstanding', 422);
        }

        // The demo link hands the handler its input without the router's schema
        // in front of it, so the bounds the server would have enforced are this
        // handler's to enforce. A zero or negative amount otherwise breaks the
        // allocation loop on its first pass, writes no payment row, and still
        // reports an `outstandingAfter` the stored rows do not produce.
        assertAmount(input.amount, 'payment');
        if (input.amount <= 0) {
            throw new DemoError(ERROR_CODE.VALIDATION, 'a payment must be more than nothing', 422);
        }

        if (input.amount > outstandingBefore) {
            throw new DemoError(
                ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
                'a payment may not exceed what the patient owes',
                422,
            );
        }

        let remaining = input.amount;
        const visits: SettleReport['visits'] = [];

        for (const visit of unsettled) {
            if (remaining <= 0) break;

            const amount = Math.min(remaining, visit.balance);
            remaining -= amount;

            visits.push({
                visitId: visit.visitId,
                ref: visit.ref,
                startsAt: visit.startsAt,
                outstandingBefore: visit.balance,
                amount,
                outstandingAfter: visit.balance - amount,
                settled: visit.balance === amount,
            });
        }

        for (const visit of visits) {
            insertPayment(visit.visitId, visit.amount, input.method, input.methodNote ?? null);
        }

        save();
        for (const _visit of visits) broadcast(WS_EVENT.VISIT_UPDATED);

        return {
            patientId: input.patientId,
            amount: input.amount,
            method: input.method,
            outstandingBefore,
            outstandingAfter: outstandingBefore - input.amount,
            visits,
        };
    },

    summary(input: RouterInput['balance']['summary']): BalanceSummary {
        const db = getDb();
        const { from, to } = rangeOf(input);

        const inRange = db.visits
            .map((visit) => ({
                visit,
                appointment: db.appointments.find((row) => row.id === visit.appointmentId),
            }))
            .filter(
                (pair) =>
                    pair.appointment &&
                    !pair.appointment.isOpeningBalance &&
                    pair.appointment.startsAt >= from &&
                    pair.appointment.startsAt < to,
            );

        const charged = inRange.reduce((sum, pair) => sum + pair.visit.chargedTotal, 0);

        const collected = db.payments
            .filter((payment) => payment.paidAt >= from && payment.paidAt < to)
            .reduce((sum, payment) => sum + payment.amount, 0);

        // One patient with three unpaid visits is one patient.
        const duePatients = new Set(
            inRange
                .filter((pair) => pair.visit.chargedTotal - paidFor(pair.visit.id) > 0)
                .map((pair) => pair.appointment?.patientId),
        ).size;

        // Money that arrived in the range against a visit dated before it. A
        // real join of payment date against visit date — emphatically not
        // `collected - charged`, which is only the period's net position.
        const older = db.payments.filter((payment) => {
            if (payment.paidAt < from || payment.paidAt >= to) return false;
            const visit = db.visits.find((row) => row.id === payment.visitId);
            const appointment = visit && db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment ? appointment.startsAt < from : false;
        });

        return {
            charged,
            collected,
            difference: charged - collected,
            duePatients,
            olderCollected: older.reduce((sum, payment) => sum + payment.amount, 0),
            olderVisits: new Set(older.map((payment) => payment.visitId)).size,
        };
    },

    /**
     * A method nobody used is absent rather than a zero row. Refunds are
     * negative payments, so a method's total can come out below zero — and that
     * is the honest figure.
     */
    takings(input: RouterInput['balance']['takings']): TakingsReport {
        const { from, to } = rangeOf(input);
        const totals = new Map<
            TakingsReport['byMethod'][number]['method'],
            { amount: number; count: number }
        >();

        for (const payment of getDb().payments) {
            if (payment.paidAt < from || payment.paidAt >= to) continue;

            const entry = totals.get(payment.method) ?? { amount: 0, count: 0 };
            entry.amount += payment.amount;
            entry.count += 1;
            totals.set(payment.method, entry);
        }

        const byMethod = [...totals.entries()]
            .map(([method, entry]) => ({ method, amount: entry.amount, count: entry.count }))
            .sort((a, b) => b.amount - a.amount);

        return { total: byMethod.reduce((sum, row) => sum + row.amount, 0), byMethod };
    },
};
