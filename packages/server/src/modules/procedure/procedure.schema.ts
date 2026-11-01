/**
 * SPEC §5, §12. Prices are integer piastres — never floats. A null `parentId`
 * makes a row a category root (one level of nesting only); `isToothSpecific`
 * means lines for the procedure must name a tooth, and others must not.
 */
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

/**
 * A category and the first subtype under it, written together. A category is a
 * row something else names as a parent, so one with nothing under it is just a
 * root with a price and `list` would offer it on a visit — the pair is the unit
 * that makes sense, and `procedureService.createCategory` writes it as one.
 */
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

/**
 * The whole new order of one group of siblings, applied as one write. A row's
 * position is its index, so a half-applied list cannot exist — see
 * `procedureService.reorder`.
 */
export const reorderProceduresInput = z.object({
    ids: z.array(z.uuid()).min(1).max(500),
});

/** The schema defaults `cost` on the wire; a caller inside the server, a seed or a test, may leave it out. */
type CostOptional<T extends { cost: number }> = Omit<T, 'cost'> & { cost?: number };
type CategoryInput = z.infer<typeof createCategoryInput>;

export type CreateProcedureInput = CostOptional<z.infer<typeof createProcedureInput>>;
export type CreateCategoryInput = Omit<CategoryInput, 'first'> & {
    first: CostOptional<CategoryInput['first']>;
};
export type UpdateProcedureInput = z.infer<typeof updateProcedureInput>;
export type ProcedureTreeInput = z.infer<typeof procedureTreeInput>;
export type ReorderProceduresInput = z.infer<typeof reorderProceduresInput>;

/**
 * One line of an old visit. It carries a **price**, because the visit it lands
 * in is a real one: the work was done here, it was simply typed in late, and
 * the patient owes for it.
 *
 * `unitPrice` is optional and falls back to the catalogue's price the same way
 * `visit.setProcedures` does — the desk usually means "the usual price", and
 * the snapshot is taken at the write either way, so a later catalogue change
 * cannot rewrite what was charged (§7).
 */
const oldVisitLine = z.object({
    procedureId: z.uuid(),
    quantity: z.number().int().min(1).max(999).default(1),
    tooth: z.enum(TEETH).nullish(),
    unitPrice: price.optional(),
});

/** One trip to the record adds one visit's worth. Past that it is a paste, not a visit. */
const MAX_OLD_VISIT_LINES = 50;

/**
 * A visit that happened on a day that has passed and was never entered.
 *
 * The date is required — that is the whole difference from a walk-in, which is
 * always *now*. There is no time of day: the clinic is recording which day it
 * was, not which slot, so the row is stamped at noon UTC and reads back as that
 * day from any offset (see `migration.service` for why noon).
 */
export const addOldVisitInput = z.object({
    patientId: z.uuid(),
    /** `YYYY-MM-DD`. Refused if it has not happened — see the service. */
    performedOn: z.iso.date(),
    /** Defaults to the clinic's first active branch when the caller does not say. */
    branchId: z.uuid().nullish(),
    procedures: z.array(oldVisitLine).min(1).max(MAX_OLD_VISIT_LINES),
    /** The client's UTC offset, so "a day that has happened" is the clinic's day, not the server's. */
    offsetMinutes: z.number().int().min(-840).max(840).default(0),
});

export type AddOldVisitInput = z.infer<typeof addOldVisitInput>;
