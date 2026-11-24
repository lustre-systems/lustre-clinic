import { ERROR_CODE, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, save } from '../db';
import { broadcast } from '../events';
import { ageFromBirthDate, assertAmount, DemoError, dayRange } from '../rules';
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
                    age: ageFromBirthDate(patient?.birthDate ?? null),
                    gender: patient?.gender ?? null,
                    balance: entry.balance,
                    oldestUnpaidAt: entry.oldestUnpaidAt ?? new Date(),
                };
            })
            .sort((a, b) => b.balance - a.balance);

        return { total: patients.reduce((sum, row) => sum + row.balance, 0), patients };
    },

    byPatient(input: RouterInput['balance']['byPatient']): VisitBalance[] {
        return unsettledVisits(input.patientId);
    },

    settle(input: RouterInput['balance']['settle']): SettleReport {
        const unsettled = unsettledVisits(input.patientId);
        const outstandingBefore = unsettled.reduce((total, visit) => total + visit.balance, 0);

        if (outstandingBefore <= 0) {
            throw new DemoError(ERROR_CODE.NOTHING_OUTSTANDING, 'this patient has nothing outstanding', 422);
        }

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

        const duePatients = new Set(
            inRange
                .filter((pair) => pair.visit.chargedTotal - paidFor(pair.visit.id) > 0)
                .map((pair) => pair.appointment?.patientId),
        ).size;

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
