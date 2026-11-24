import { MAX_AMOUNT_PIASTRES, paymentMethodSchema } from '@lustre/shared';
import { z } from 'zod';

export const byPatientInput = z.object({ patientId: z.uuid() });

export const outstandingInput = z.object({ patientIds: z.array(z.uuid()).max(100).optional() }).optional();

export const settleInput = z
    .object({
        patientId: z.uuid(),
        amount: z.number().int().min(1).max(MAX_AMOUNT_PIASTRES),
        method: paymentMethodSchema,
        methodNote: z.string().trim().max(200).nullish(),
    })
    .refine((v) => v.method !== 'other' || !!v.methodNote?.trim(), {
        message: "method 'other' requires methodNote",
        path: ['methodNote'],
    });

const offset = z.number().int().min(-840).max(840);

const range = {
    from: z.iso.date(),
    to: z.iso.date(),
    offsetMinutes: offset.default(0),
    fromOffsetMinutes: offset.optional(),
};

export const balanceSummaryInput = z.object(range);

export const balanceTakingsInput = z.object(range);

export type SettleInput = z.infer<typeof settleInput>;
export type BalanceSummaryInput = z.infer<typeof balanceSummaryInput>;
export type BalanceTakingsInput = z.infer<typeof balanceTakingsInput>;
