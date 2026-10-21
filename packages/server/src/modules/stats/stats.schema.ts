/**
 * SPEC §13 — `stats.summary({ from, to, branchId })` for the doctor view (§6),
 * and the owner's stats screen: `stats.overview` for one period and
 * `stats.trend` for a run of them.
 *
 * `fromOffsetMinutes` is the same DST guard `balance` takes: a range that
 * crosses a changeover opens at its first day's offset, not its last's.
 */
import { z } from 'zod';

const offset = z.number().int().min(-840).max(840);

export const statsSummaryInput = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    branchId: z.uuid().optional(),
    offsetMinutes: offset.default(0),
});

const period = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    offsetMinutes: offset.default(0),
    fromOffsetMinutes: offset.optional(),
});

export const statsOverviewInput = period;

/** One bar per period, oldest first. Twelve is a year of months. */
export const statsTrendInput = z.object({ periods: z.array(period).min(1).max(12) });

export type StatsSummaryInput = z.infer<typeof statsSummaryInput>;
export type StatsPeriod = z.infer<typeof period>;
