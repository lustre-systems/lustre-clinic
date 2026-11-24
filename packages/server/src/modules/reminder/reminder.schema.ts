import { z } from 'zod';

export const pendingRemindersInput = z
    .object({
        dueOnly: z.boolean().default(true),
        limit: z.number().int().min(1).max(200).default(100),
        offsetMinutes: z.number().int().min(-840).max(840).default(0),
        throughToday: z.boolean().optional(),
    })
    .default({ dueOnly: true, limit: 100, offsetMinutes: 0 });

export const reminderIdInput = z.object({ id: z.uuid() });

export const dismissTodayInput = z.object({
    date: z.iso.date(),
});

export type PendingRemindersInput = z.infer<typeof pendingRemindersInput>;
export type DismissTodayInput = z.infer<typeof dismissTodayInput>;
