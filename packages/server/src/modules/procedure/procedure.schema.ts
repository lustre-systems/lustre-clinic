import { MAX_AMOUNT_PIASTRES, MAX_PROCEDURE_NAME, TEETH } from '@lustre/shared';
import { z } from 'zod';

const price = z.number().int().min(0).max(MAX_AMOUNT_PIASTRES);

export const createProcedureInput = z.object({
    parentId: z.uuid().nullish(),
    name: z.string().trim().min(1).max(MAX_PROCEDURE_NAME),
    defaultPrice: price,
    cost: price.default(0),
    hasQuantity: z.boolean().default(false),
    isToothSpecific: z.boolean().default(false),
    isCheckup: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const updateProcedureInput = z.object({
    id: z.uuid(),
    parentId: z.uuid().nullish(),
    name: z.string().trim().min(1).max(MAX_PROCEDURE_NAME).optional(),
    defaultPrice: price.optional(),
    cost: price.optional(),
    hasQuantity: z.boolean().optional(),
    isToothSpecific: z.boolean().optional(),
    isCheckup: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const procedureTreeInput = z
    .object({
        includeInactive: z.boolean().default(false),
    })
    .default({ includeInactive: false });

export const createCategoryInput = z.object({
    name: z.string().trim().min(1).max(MAX_PROCEDURE_NAME),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    first: z.object({
        name: z.string().trim().min(1).max(MAX_PROCEDURE_NAME),
        defaultPrice: price,
        cost: price.default(0),
        hasQuantity: z.boolean().default(false),
        isToothSpecific: z.boolean().default(false),
        isCheckup: z.boolean().default(false),
    }),
});

export const reorderProceduresInput = z.object({
    ids: z.array(z.uuid()).min(1).max(500),
});

type CostOptional<T extends { cost: number }> = Omit<T, 'cost'> & { cost?: number };
type CategoryInput = z.infer<typeof createCategoryInput>;

export type CreateProcedureInput = CostOptional<z.infer<typeof createProcedureInput>>;
export type CreateCategoryInput = Omit<CategoryInput, 'first'> & {
    first: CostOptional<CategoryInput['first']>;
};
export type UpdateProcedureInput = z.infer<typeof updateProcedureInput>;
export type ProcedureTreeInput = z.infer<typeof procedureTreeInput>;
export type ReorderProceduresInput = z.infer<typeof reorderProceduresInput>;

const oldVisitLine = z.object({
    procedureId: z.uuid(),
    quantity: z.number().int().min(1).max(999).default(1),
    tooth: z.enum(TEETH).nullish(),
    unitPrice: price.optional(),
});

const MAX_OLD_VISIT_LINES = 50;

export const addOldVisitInput = z.object({
    patientId: z.uuid(),
    performedOn: z.iso.date(),
    branchId: z.uuid().nullish(),
    procedures: z.array(oldVisitLine).min(1).max(MAX_OLD_VISIT_LINES),
    offsetMinutes: z.number().int().min(-840).max(840).default(0),
});

export type AddOldVisitInput = z.infer<typeof addOldVisitInput>;
