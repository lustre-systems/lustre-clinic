import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
    appointments,
    branches,
    patients,
    payments,
    procedureTypes,
    visitProcedures,
    visits,
} from '../../db/schema.ts';
import { dayRange } from '../../util/time.ts';
import { balanceService } from '../balance/balance.service.ts';
import type { StatsPeriod, StatsSummaryInput } from './stats.schema.ts';

interface StatsSummary {
    from: Date;
    to: Date;
    appointments: {
        total: number;
        completed: number;
        cancelled: number;
        noShow: number;
        walkIns: number;
        stillBooked: number;
    };
    visits: {
        total: number;
        charged: number;
        collected: number;
        outstanding: number;
    };
    topProcedures: { procedureId: string; name: string; count: number; revenue: number }[];
}

interface BranchFigures {
    branchId: string;
    name: string;
    revenue: number;
    cost: number;
    profit: number;
    workingDays: number;
}

interface StatsFigures {
    from: Date;
    to: Date;
    revenue: number;
    cost: number;
    profit: number;
    newPatients: number;
    branches: BranchFigures[];
}

function amount(total: string | number | null): number {
    return total === null ? 0 : Number(total);
}

async function figuresFor(period: StatsPeriod): Promise<StatsFigures> {
    const first = dayRange(period.from, period.fromOffsetMinutes ?? period.offsetMinutes);
    const last = dayRange(period.to, period.offsetMinutes);
    const from = new Date(first.from.getTime() + (period.fromMinute ?? 0) * 60_000);
    const to =
        period.toMinute === undefined ? last.to : new Date(last.from.getTime() + period.toMinute * 60_000);

    const lineCost = db
        .select({
            visitId: visitProcedures.visitId,
            cost: sql<string>`SUM(${visitProcedures.unitCost} * ${visitProcedures.quantity})::bigint`.as(
                'cost',
            ),
        })
        .from(visitProcedures)
        .groupBy(visitProcedures.visitId)
        .as('line_cost');

    const localDay = sql`((${appointments.startsAt} AT TIME ZONE 'UTC') + make_interval(mins => ${period.offsetMinutes}))::date`;

    const byBranch = await db
        .select({
            branchId: branches.id,
            name: branches.name,
            revenue: sql<string>`COALESCE(SUM(${visits.chargedTotal}), 0)::bigint`,
            cost: sql<string>`COALESCE(SUM(${lineCost.cost}), 0)::bigint`,
            workingDays: sql<number>`COUNT(DISTINCT ${localDay})::int`,
        })
        .from(visits)
        .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
        .innerJoin(branches, eq(appointments.branchId, branches.id))
        .leftJoin(lineCost, eq(lineCost.visitId, visits.id))
        .where(
            and(
                gte(appointments.startsAt, from),
                lt(appointments.startsAt, to),
                eq(appointments.isOpeningBalance, false),
                eq(appointments.isImported, false),
            ),
        )
        .groupBy(branches.id, branches.name)
        .orderBy(asc(branches.name));

    const [registered] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(patients)
        .where(and(gte(patients.createdAt, from), lt(patients.createdAt, to), isNull(patients.legacyRef)));

    const perBranch = byBranch.map((row) => {
        const revenue = amount(row.revenue);
        const cost = amount(row.cost);
        return {
            branchId: row.branchId,
            name: row.name,
            revenue,
            cost,
            profit: revenue - cost,
            workingDays: row.workingDays,
        };
    });

    const revenue = perBranch.reduce((sum, row) => sum + row.revenue, 0);
    const cost = perBranch.reduce((sum, row) => sum + row.cost, 0);

    return {
        from,
        to,
        revenue,
        cost,
        profit: revenue - cost,
        newPatients: registered?.count ?? 0,
        branches: perBranch,
    };
}

export const statsService = {
    overview(input: StatsPeriod): Promise<StatsFigures> {
        return figuresFor(input);
    },

    trend(periods: StatsPeriod[]): Promise<StatsFigures[]> {
        return Promise.all(periods.map(figuresFor));
    },

    async summary(input: StatsSummaryInput): Promise<StatsSummary> {
        const { from } = dayRange(input.from, input.offsetMinutes);
        const { to } = dayRange(input.to, input.offsetMinutes);

        const inPeriod = and(
            gte(appointments.startsAt, from),
            lt(appointments.startsAt, to),
            eq(appointments.isOpeningBalance, false),
            eq(appointments.isImported, false),
            ...(input.branchId ? [eq(appointments.branchId, input.branchId)] : []),
        );

        const [counts] = await db
            .select({
                total: sql<number>`COUNT(*)::int`,
                completed: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'done')::int`,
                cancelled: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')::int`,
                noShow: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
                walkIns: sql<number>`COUNT(*) FILTER (WHERE ${appointments.channel} = 'walk_in')::int`,
                stillBooked: sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'booked')::int`,
            })
            .from(appointments)
            .where(inPeriod);

        const [visitTotals] = await db
            .select({
                total: sql<number>`COUNT(*)::int`,
                charged: sql<number>`COALESCE(SUM(${visits.chargedTotal}), 0)::int`,
            })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .where(inPeriod);

        const [collected] = await db
            .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
            .from(payments)
            .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to)));

        const topProcedures = await db
            .select({
                procedureId: procedureTypes.id,
                name: procedureTypes.name,
                count: sql<number>`SUM(${visitProcedures.quantity})::int`,
                revenue: sql<number>`SUM(${visitProcedures.unitPrice} * ${visitProcedures.quantity})::int`,
            })
            .from(visitProcedures)
            .innerJoin(visits, eq(visitProcedures.visitId, visits.id))
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .innerJoin(procedureTypes, eq(visitProcedures.procedureId, procedureTypes.id))
            .where(inPeriod)
            .groupBy(procedureTypes.id, procedureTypes.name)
            .orderBy(desc(sql`SUM(${visitProcedures.quantity})`))
            .limit(10);

        const { total: outstanding } = await balanceService.outstanding();

        return {
            from,
            to,
            appointments: {
                total: counts?.total ?? 0,
                completed: counts?.completed ?? 0,
                cancelled: counts?.cancelled ?? 0,
                noShow: counts?.noShow ?? 0,
                walkIns: counts?.walkIns ?? 0,
                stillBooked: counts?.stillBooked ?? 0,
            },
            visits: {
                total: visitTotals?.total ?? 0,
                charged: visitTotals?.charged ?? 0,
                collected: collected?.total ?? 0,
                outstanding,
            },
            topProcedures,
        };
    },
};
