/**
 * SPEC §13 — `stats.summary({ from, to, branchId })` for the doctor view (§6),
 * and the owner's stats screen: `stats.overview` for one period and
 * `stats.trend` for a run of them.
 *
 * `fromOffsetMinutes` is the same DST guard `balance` takes: a range that
 * crosses a changeover opens at its first day's offset, not its last's.
 * `fromMinute` / `toMinute` narrow the range inside its first and last day,
 * for the hours of "Today" and for "so far" comparisons: the range then opens
 * that many minutes into `from` and closes that many minutes into `to`.
 */
import { z } from 'zod';

const offset = z.number().int().min(-840).max(840);
const minuteOfDay = z.number().int().min(0).max(1440);

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
    fromMinute: minuteOfDay.optional(),
    toMinute: minuteOfDay.optional(),
});

export const statsOverviewInput = period;

/** One point per period, oldest first. Twenty-four is a day of hours. */
export const statsTrendInput = z.object({ periods: z.array(period).min(1).max(24) });

export type StatsSummaryInput = z.infer<typeof statsSummaryInput>;
export type StatsPeriod = z.infer<typeof period>;
