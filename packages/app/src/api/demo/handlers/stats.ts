/**
 * `server/src/modules/stats/stats.service.ts` — the doctor view's numbers for a
 * period. Everything is an aggregate over the same rows the rest of the app
 * writes, so a stat cannot drift from what happened.
 *
 * Opening-balance rows are debt the clinic inherited, not a day's work:
 * counting them would report a cutoff date on which hundreds of patients were
 * seen. `outstanding` is the one figure that does include them, because they
 * are still owed, and it is the standing balance rather than a per-period one.
 */
import type { RouterInput, RouterOutput } from '../../types';
import { getDb } from '../db';
import { clinicDayOf, dayRange } from '../rules';
import type { Dated } from '../wire';
import { balanceHandlers, rangeOf } from './balance';

type StatsSummary = Dated<RouterOutput['stats']['summary']>;
type StatsFigures = Dated<RouterOutput['stats']['overview']>;
type StatsPeriod = RouterInput['stats']['overview'];
type BranchFigures = StatsFigures['branches'][number];

/** `statsService.overview`: profit is revenue less each line's snapshotted cost, split by branch. */
function figuresFor(period: StatsPeriod): StatsFigures {
    const db = getDb();
    const days = rangeOf(period);
    const offsetMinutes = period.offsetMinutes ?? 0;
    // `statsService`'s minute bounds: the range opens and closes that far into its first and last day.
    const from = new Date(days.from.getTime() + (period.fromMinute ?? 0) * 60_000);
    const to =
        period.toMinute === undefined
            ? days.to
            : new Date(dayRange(period.to, offsetMinutes).from.getTime() + period.toMinute * 60_000);

    const inPeriod = new Map(
        db.appointments
            .filter(
                (row) =>
                    row.startsAt >= from && row.startsAt < to && !row.isOpeningBalance && !row.isImported,
            )
            .map((row) => [row.id, row]),
    );

    const tally = new Map<string, BranchFigures & { days: Set<string> }>();
    for (const visit of db.visits) {
        const appointment = inPeriod.get(visit.appointmentId);
        if (!appointment) continue;

        const name = db.branches.find((row) => row.id === appointment.branchId)?.name ?? '';
        const entry = tally.get(appointment.branchId) ?? {
            branchId: appointment.branchId,
            name,
            revenue: 0,
            cost: 0,
            profit: 0,
            workingDays: 0,
            days: new Set<string>(),
        };
        const cost = db.visitProcedures
            .filter((line) => line.visitId === visit.id)
            .reduce((sum, line) => sum + line.unitCost * line.quantity, 0);

        entry.revenue += visit.chargedTotal;
        entry.cost += cost;
        entry.profit = entry.revenue - entry.cost;
        entry.days.add(clinicDayOf(appointment.startsAt, offsetMinutes).from.toISOString());
        tally.set(appointment.branchId, entry);
    }

    const branches = [...tally.values()]
        .map(({ days, ...row }) => ({ ...row, workingDays: days.size }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const revenue = branches.reduce((sum, row) => sum + row.revenue, 0);
    const cost = branches.reduce((sum, row) => sum + row.cost, 0);

    const newPatients = db.patients.filter(
        (row) => row.createdAt >= from && row.createdAt < to && row.legacyRef === null,
    ).length;

    return { from, to, revenue, cost, profit: revenue - cost, newPatients, branches };
}

export const statsHandlers = {
    overview(input: RouterInput['stats']['overview']): StatsFigures {
        return figuresFor(input);
    },

    trend(input: RouterInput['stats']['trend']): StatsFigures[] {
        return input.periods.map(figuresFor);
    },

    summary(input: RouterInput['stats']['summary']): StatsSummary {
        const db = getDb();
        const offsetMinutes = input.offsetMinutes ?? 0;
        const { from } = dayRange(input.from, offsetMinutes);
        const { to } = dayRange(input.to, offsetMinutes);

        const inPeriod = db.appointments.filter(
            (row) =>
                row.startsAt >= from &&
                row.startsAt < to &&
                !row.isOpeningBalance &&
                (input.branchId ? row.branchId === input.branchId : true),
        );

        const ids = new Set(inPeriod.map((row) => row.id));
        const visits = db.visits.filter((visit) => ids.has(visit.appointmentId));

        const collected = db.payments
            .filter((payment) => payment.paidAt >= from && payment.paidAt < to)
            .reduce((sum, payment) => sum + payment.amount, 0);

        const visitIds = new Set(visits.map((visit) => visit.id));
        const tally = new Map<string, { name: string; count: number; revenue: number }>();

        for (const line of db.visitProcedures) {
            if (!visitIds.has(line.visitId)) continue;

            const name = db.procedureTypes.find((row) => row.id === line.procedureId)?.name ?? 'Procedure';
            const entry = tally.get(line.procedureId) ?? { name, count: 0, revenue: 0 };
            entry.count += line.quantity;
            entry.revenue += line.unitPrice * line.quantity;
            tally.set(line.procedureId, entry);
        }

        const topProcedures = [...tally.entries()]
            .map(([procedureId, entry]) => ({ procedureId, ...entry }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const countOf = (predicate: (row: (typeof inPeriod)[number]) => boolean): number =>
            inPeriod.filter(predicate).length;

        return {
            from,
            to,
            appointments: {
                total: inPeriod.length,
                completed: countOf((row) => row.status === 'done'),
                cancelled: countOf((row) => row.status === 'cancelled'),
                noShow: countOf((row) => row.status === 'no_show'),
                walkIns: countOf((row) => row.channel === 'walk_in'),
                stillBooked: countOf((row) => row.status === 'booked'),
            },
            visits: {
                total: visits.length,
                charged: visits.reduce((sum, visit) => sum + visit.chargedTotal, 0),
                collected,
                outstanding: balanceHandlers.outstanding().total,
            },
            topProcedures,
        };
    },
};
