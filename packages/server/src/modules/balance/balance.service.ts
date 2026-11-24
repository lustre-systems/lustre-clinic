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
    duePatients: number;
    olderCollected: number;
    olderVisits: number;
}

interface SettledVisit {
    visitId: string;
    ref: string;
    startsAt: Date;
    outstandingBefore: number;
    amount: number;
    outstandingAfter: number;
    settled: boolean;
}

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

function piastres(total: string | number | null): number {
    return total === null ? 0 : Number(total);
}

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

    async settle(input: SettleInput): Promise<SettleReport> {
        const report = await db.transaction(async (tx) => {
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

        for (const visit of report.visits) {
            broadcast(WS_EVENT.VISIT_UPDATED, { id: visit.visitId });
        }

        return report;
    },

    async summary(input: BalanceSummaryInput): Promise<BalanceSummary> {
        const { from, to } = rangeOf(input);

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
