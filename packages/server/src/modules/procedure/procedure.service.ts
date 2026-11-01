/**
 * SPEC §5, §12. The hierarchy is one level deep. A row with children is a
 * category and is not selectable; only leaves are. Both rules are enforced
 * here, in the service layer, because the schema cannot express them.
 *
 * Parenthood is computed over every row, active or not, everywhere — a
 * deactivated subtype must not make its category look selectable to a picker.
 * `findCheckup` supplies the line seeded on check-in (§8), and exactly one row
 * carries the flag it looks for — see `clearOtherCheckups`.
 */
import { ERROR_CODE, type Role, seesStats, WS_EVENT } from '@lustre/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { procedureTypes } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { broadcast } from '../../ws/index.ts';
import type {
    CreateCategoryInput,
    CreateProcedureInput,
    ProcedureTreeInput,
    ReorderProceduresInput,
    UpdateProcedureInput,
} from './procedure.schema.ts';

export type Procedure = typeof procedureTypes.$inferSelect;

/** A catalogue row as a phone reads it: `cost` is null on one that may not see it. */
type ShownProcedure = Omit<Procedure, 'cost'> & { cost: number | null };

interface ProcedureNode extends ShownProcedure {
    children: ShownProcedure[];
    selectable: boolean;
}

function shown(row: Procedure, viewer: Role | null): ShownProcedure {
    return seesStats(viewer) ? row : { ...row, cost: null };
}

async function requireRow(id: string): Promise<Procedure> {
    const [row] = await db.select().from(procedureTypes).where(eq(procedureTypes.id, id)).limit(1);
    if (!row) throw AppError.notFound('procedure');
    return row;
}

async function hasChildren(id: string): Promise<boolean> {
    const [child] = await db
        .select({ id: procedureTypes.id })
        .from(procedureTypes)
        .where(eq(procedureTypes.parentId, id))
        .limit(1);
    return child !== undefined;
}

/**
 * The checkup is held by exactly one procedure (§8/§9): it is the line waived
 * when other work is done, and two of them would make which one gets waived a
 * matter of `sortOrder`. Taking the flag hands it over rather
 * than sharing it, in the same transaction as the write that took it.
 */
async function clearOtherCheckups(tx: Executor, keep: string): Promise<void> {
    await tx
        .update(procedureTypes)
        .set({ isCheckup: false })
        .where(and(eq(procedureTypes.isCheckup, true), ne(procedureTypes.id, keep)));
}

async function assertUsableAsParent(parentId: string): Promise<void> {
    const parent = await requireRow(parentId);
    if (parent.parentId !== null) {
        throw new AppError(ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP, 'a subtype may not have children', 422);
    }
}

export const procedureService = {
    async tree(
        input: ProcedureTreeInput = { includeInactive: false },
        viewer: Role | null = null,
    ): Promise<ProcedureNode[]> {
        const rows = await db
            .select()
            .from(procedureTypes)
            .orderBy(asc(procedureTypes.sortOrder), asc(procedureTypes.name));

        const visible = input.includeInactive ? rows : rows.filter((r) => r.active);

        const childrenByParent = new Map<string, Procedure[]>();
        for (const row of visible) {
            if (!row.parentId) continue;
            const siblings = childrenByParent.get(row.parentId) ?? [];
            siblings.push(row);
            childrenByParent.set(row.parentId, siblings);
        }

        const parents = new Set(rows.map((r) => r.parentId).filter((id): id is string => id !== null));

        return visible
            .filter((row) => row.parentId === null)
            .map((root) => ({
                ...shown(root, viewer),
                children: (childrenByParent.get(root.id) ?? []).map((child) => shown(child, viewer)),
                selectable: !parents.has(root.id),
            }));
    },

    async byId(id: string): Promise<Procedure> {
        return requireRow(id);
    },

    async requireSelectable(id: string): Promise<Procedure> {
        const row = await requireRow(id);
        if (await hasChildren(row.id)) {
            throw new AppError(ERROR_CODE.PROCEDURE_NOT_SELECTABLE, 'that procedure is a category', 422);
        }
        return row;
    },

    async findCheckup(): Promise<Procedure | null> {
        const [row] = await db
            .select()
            .from(procedureTypes)
            .where(and(eq(procedureTypes.isCheckup, true), eq(procedureTypes.active, true)))
            .orderBy(asc(procedureTypes.sortOrder), asc(procedureTypes.name))
            .limit(1);
        return row ?? null;
    },

    async create(input: CreateProcedureInput): Promise<Procedure> {
        if (input.parentId) await assertUsableAsParent(input.parentId);

        const created = await db.transaction(async (tx) => {
            const [row] = await tx
                .insert(procedureTypes)
                .values({
                    id: Bun.randomUUIDv7(),
                    parentId: input.parentId ?? null,
                    name: input.name,
                    defaultPrice: input.defaultPrice,
                    cost: input.cost ?? 0,
                    hasQuantity: input.hasQuantity,
                    isToothSpecific: input.isToothSpecific,
                    isCheckup: input.isCheckup,
                    sortOrder: input.sortOrder,
                })
                .returning();

            if (!row) throw AppError.internal('procedure insert returned nothing');
            if (row.isCheckup) await clearOtherCheckups(tx, row.id);
            return row;
        });

        broadcast(WS_EVENT.CATALOG_UPDATED, { id: created.id });
        return created;
    },

    /**
     * A category and the first subtype under it, in one transaction. Two calls
     * would leave a childless root priced 0 behind whenever the second failed —
     * which is not a category at all but a procedure `list` would happily offer
     * on a visit, and a retry would write the heading twice.
     */
    async createCategory(input: CreateCategoryInput): Promise<{ category: Procedure; first: Procedure }> {
        const created = await db.transaction(async (tx) => {
            const [category] = await tx
                .insert(procedureTypes)
                .values({
                    id: Bun.randomUUIDv7(),
                    parentId: null,
                    name: input.name,
                    defaultPrice: 0,
                    sortOrder: input.sortOrder,
                })
                .returning();

            if (!category) throw AppError.internal('category insert returned nothing');

            const [first] = await tx
                .insert(procedureTypes)
                .values({
                    id: Bun.randomUUIDv7(),
                    parentId: category.id,
                    name: input.first.name,
                    defaultPrice: input.first.defaultPrice,
                    cost: input.first.cost ?? 0,
                    hasQuantity: input.first.hasQuantity,
                    isToothSpecific: input.first.isToothSpecific,
                    isCheckup: input.first.isCheckup,
                    sortOrder: 0,
                })
                .returning();

            if (!first) throw AppError.internal('procedure insert returned nothing');
            if (first.isCheckup) await clearOtherCheckups(tx, first.id);

            return { category, first };
        });

        broadcast(WS_EVENT.CATALOG_UPDATED, { id: created.category.id });
        return created;
    },

    async update({ id, ...patch }: UpdateProcedureInput): Promise<Procedure> {
        const current = await requireRow(id);

        if (patch.parentId !== undefined && patch.parentId !== null) {
            if (patch.parentId === id) {
                throw new AppError(
                    ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP,
                    'a procedure cannot be its own parent',
                    422,
                );
            }
            await assertUsableAsParent(patch.parentId);

            if (await hasChildren(id)) {
                throw new AppError(
                    ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP,
                    'a category with children cannot become a subtype',
                    422,
                );
            }
        }

        const updated = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(procedureTypes)
                .set({
                    ...patch,
                    parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
                })
                .where(eq(procedureTypes.id, id))
                .returning();

            if (!row) throw AppError.notFound('procedure');
            if (patch.isCheckup) await clearOtherCheckups(tx, row.id);
            return row;
        });

        broadcast(WS_EVENT.CATALOG_UPDATED, { id });
        return updated;
    },

    /**
     * The whole order of one sibling group, in one transaction. The client
     * sends the list it wants and every row is stamped with its index, so a
     * connection that drops mid-write leaves the previous order intact rather
     * than half of each.
     *
     * The ids must be siblings: `sortOrder` is only ever compared within a
     * group, so a list spanning two categories would write positions that mean
     * nothing next to each other.
     */
    async reorder({ ids }: ReorderProceduresInput): Promise<void> {
        if (new Set(ids).size !== ids.length) {
            throw new AppError(ERROR_CODE.VALIDATION, 'the same procedure appears twice in the order', 422);
        }

        await db.transaction(async (tx) => {
            const rows = await tx
                .select({ id: procedureTypes.id, parentId: procedureTypes.parentId })
                .from(procedureTypes)
                .where(inArray(procedureTypes.id, ids));

            if (rows.length !== ids.length) throw AppError.notFound('procedure');

            if (new Set(rows.map((row) => row.parentId)).size > 1) {
                throw new AppError(ERROR_CODE.VALIDATION, 'a reorder must name one group of siblings', 422);
            }

            for (const [index, id] of ids.entries()) {
                await tx.update(procedureTypes).set({ sortOrder: index }).where(eq(procedureTypes.id, id));
            }
        });
        broadcast(WS_EVENT.CATALOG_UPDATED);
    },

    async selectableList(viewer: Role | null = null): Promise<ShownProcedure[]> {
        const rows = await db
            .select()
            .from(procedureTypes)
            .orderBy(asc(procedureTypes.sortOrder), asc(procedureTypes.name));

        const parents = new Set(rows.map((r) => r.parentId).filter((id): id is string => id !== null));
        return rows.filter((row) => row.active && !parents.has(row.id)).map((row) => shown(row, viewer));
    },
};
