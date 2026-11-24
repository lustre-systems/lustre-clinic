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

export const statsTrendInput = z.object({ periods: z.array(period).min(1).max(24) });

export type StatsSummaryInput = z.infer<typeof statsSummaryInput>;
export type StatsPeriod = z.infer<typeof period>;
