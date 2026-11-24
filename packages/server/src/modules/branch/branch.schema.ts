import { whatsAppAppSchema } from '@lustre/shared';
import { z } from 'zod';

export const createBranchInput = z.object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(500).nullish(),
    whatsappApp: whatsAppAppSchema.optional(),
});

export const updateBranchInput = z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(500).nullish(),
    active: z.boolean().optional(),
    whatsappApp: whatsAppAppSchema.optional(),
});

export const listBranchInput = z
    .object({
        includeInactive: z.boolean().default(false),
    })
    .default({ includeInactive: false });

export type CreateBranchInput = z.infer<typeof createBranchInput>;
export type UpdateBranchInput = z.infer<typeof updateBranchInput>;
export type ListBranchInput = z.infer<typeof listBranchInput>;
