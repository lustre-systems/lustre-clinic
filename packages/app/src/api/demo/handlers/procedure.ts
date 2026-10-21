/**
 * `server/src/modules/procedure/procedure.service.ts`. The hierarchy is one
 * level deep: a row something else names as a parent is a category and is not
 * selectable, and parenthood is computed over every row — active or not — so a
 * deactivated subtype cannot make its category look selectable to a picker.
 */
import { ERROR_CODE, todayKey } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, type ProcedureTypeRow, save, type VisitProcedureRow, type VisitRow } from '../db';
import { assignDefined, computeTotal, DemoError, resolveProcedureLines, uuidv7 } from '../rules';
import type { Dated } from '../wire';
import { insertAppointment } from './appointmentRow';
import { branchHandlers } from './branch';
import { requirePatient } from './patient';

type Procedure = Dated<RouterOutput['procedure']['list'][number]>;
type ProcedureNode = Dated<RouterOutput['procedure']['tree'][number]>;

function sorted(rows: readonly ProcedureTypeRow[]): ProcedureTypeRow[] {
    return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function parentIds(rows: readonly ProcedureTypeRow[]): Set<string> {
    return new Set(rows.map((row) => row.parentId).filter((id): id is string => id !== null));
}

function requireRow(id: string): ProcedureTypeRow {
    const row = getDb().procedureTypes.find((procedure) => procedure.id === id);
    if (!row) throw DemoError.notFound('procedure');
    return row;
}

function hasChildren(id: string): boolean {
    return getDb().procedureTypes.some((row) => row.parentId === id);
}

/** The checkup flag is held by exactly one row — taking it hands it over (§8/§9). */
function clearOtherCheckups(keep: string): void {
    for (const row of getDb().procedureTypes) {
        if (row.id !== keep) row.isCheckup = false;
    }
}

function assertUsableAsParent(parentId: string): void {
    const parent = requireRow(parentId);
    if (parent.parentId !== null) {
        throw new DemoError(ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP, 'a subtype may not have children', 422);
    }
}

export const procedureHandlers = {
    tree(input: RouterInput['procedure']['tree']): ProcedureNode[] {
        const rows = sorted(getDb().procedureTypes);
        const visible = input?.includeInactive ? rows : rows.filter((row) => row.active);
        const parents = parentIds(rows);

        return visible
            .filter((row) => row.parentId === null)
            .map((root) => ({
                ...root,
                children: visible.filter((row) => row.parentId === root.id),
                selectable: !parents.has(root.id),
            }));
    },

    list(): Procedure[] {
        const rows = sorted(getDb().procedureTypes);
        const parents = parentIds(rows);
        return rows.filter((row) => row.active && !parents.has(row.id));
    },

    findCheckup(): ProcedureTypeRow | null {
        return sorted(getDb().procedureTypes).find((row) => row.isCheckup && row.active) ?? null;
    },

    create(input: RouterInput['procedure']['create']): Procedure {
        if (input.parentId) assertUsableAsParent(input.parentId);

        const row: ProcedureTypeRow = {
            id: uuidv7(),
            parentId: input.parentId ?? null,
            name: input.name,
            defaultPrice: input.defaultPrice,
            hasQuantity: input.hasQuantity ?? false,
            isToothSpecific: input.isToothSpecific ?? false,
            isCheckup: input.isCheckup ?? false,
            active: true,
            sortOrder: input.sortOrder ?? 0,
        };

        getDb().procedureTypes.push(row);
        if (row.isCheckup) clearOtherCheckups(row.id);

        save();
        return row;
    },

    createCategory(
        input: RouterInput['procedure']['createCategory'],
    ): Dated<RouterOutput['procedure']['createCategory']> {
        const category: ProcedureTypeRow = {
            id: uuidv7(),
            parentId: null,
            name: input.name,
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            active: true,
            sortOrder: input.sortOrder ?? 0,
        };

        const first: ProcedureTypeRow = {
            id: uuidv7(),
            parentId: category.id,
            name: input.first.name,
            defaultPrice: input.first.defaultPrice,
            hasQuantity: input.first.hasQuantity ?? false,
            isToothSpecific: input.first.isToothSpecific ?? false,
            isCheckup: input.first.isCheckup ?? false,
            active: true,
            sortOrder: 0,
        };

        getDb().procedureTypes.push(category, first);
        if (first.isCheckup) clearOtherCheckups(first.id);

        save();
        return { category, first };
    },

    update(input: RouterInput['procedure']['update']): Procedure {
        const { id, ...patch } = input;
        const current = requireRow(id);

        if (patch.parentId !== undefined && patch.parentId !== null) {
            if (patch.parentId === id) {
                throw new DemoError(
                    ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP,
                    'a procedure cannot be its own parent',
                    422,
                );
            }
            assertUsableAsParent(patch.parentId);

            if (hasChildren(id)) {
                throw new DemoError(
                    ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP,
                    'a category with children cannot become a subtype',
                    422,
                );
            }
        }

        assignDefined(current, patch, {
            parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
        });
        if (patch.isCheckup) clearOtherCheckups(current.id);

        save();
        return current;
    },

    /**
     * `server/src/modules/procedure/procedure.history.ts` — a visit that
     * happened on a day that has passed and was never typed in. It carries
     * money: it is an ordinary completed visit, charged, and paid in cash on
     * the day unless corrected afterwards.
     */
    addOldVisit(input: RouterInput['procedure']['addOldVisit']): {
        appointmentId: string;
        visitId: string;
        chargedTotal: number;
    } {
        requirePatient(input.patientId);

        if (input.performedOn > todayKey()) {
            throw new DemoError(
                ERROR_CODE.VALIDATION,
                'an old visit has to be dated on a day that has happened',
                422,
            );
        }

        const db = getDb();
        const lines = resolveProcedureLines(
            input.procedures.map((line) => ({
                procedureId: line.procedureId,
                quantity: line.quantity ?? 1,
                tooth: line.tooth,
                note: null,
            })),
            db.procedureTypes,
            db.settings.clinicType === 'general',
        );

        const branchId = input.branchId ?? branchHandlers.list({ includeInactive: false })[0]?.id;
        if (!branchId) throw DemoError.notFound('branch');

        // Noon UTC, the same stamp the imported rows use: the row records which
        // day it was, not which slot, so it must read back as that day at any
        // offset.
        const at = new Date(`${input.performedOn}T12:00:00.000Z`);

        const priced = lines.map((line, index) => ({
            procedureId: line.procedure.id,
            quantity: line.quantity,
            unitPrice: input.procedures[index]?.unitPrice ?? line.procedure.defaultPrice,
            tooth: line.tooth,
            note: null,
        }));
        const chargedTotal = computeTotal(
            priced.map((line, index) => ({ ...line, isCheckup: lines[index]?.procedure.isCheckup ?? false })),
        );

        // `done` holds no slot, which is the only reason a past date is
        // writable at all — the day is probably already full of real rows.
        const appointment = insertAppointment(
            {
                patientId: input.patientId,
                branchId,
                startsAt: at,
                durationMinutes: db.settings.defaultDuration,
                note: 'Entered after the day it happened',
                status: 'done',
                channel: 'desk',
                isOpeningBalance: false,
                isImported: false,
                dateUnknown: false,
            },
            0,
        );

        const visit: VisitRow = {
            id: uuidv7(),
            appointmentId: appointment.id,
            checkedInAt: at,
            inChairAt: at,
            pricedAt: at,
            completedAt: at,
            computedTotal: chargedTotal,
            chargedTotal,
            nextProcedureId: null,
            nextProcedureTooth: null,
            nextAppointmentId: null,
            createdAt: at,
        };
        db.visits.push(visit);

        const rows: VisitProcedureRow[] = priced.map((line) => ({
            id: uuidv7(),
            visitId: visit.id,
            ...line,
        }));
        db.visitProcedures.push(...rows);

        // Paid in full, in cash, on the day — corrected on the visit if not.
        if (chargedTotal > 0) {
            db.payments.push({
                id: uuidv7(),
                visitId: visit.id,
                amount: chargedTotal,
                method: 'cash',
                methodNote: null,
                paidAt: at,
            });
        }

        save();
        return { appointmentId: appointment.id, visitId: visit.id, chargedTotal };
    },

    reorder(input: RouterInput['procedure']['reorder']): void {
        const { ids } = input;

        if (new Set(ids).size !== ids.length) {
            throw new DemoError(ERROR_CODE.VALIDATION, 'the same procedure appears twice in the order', 422);
        }

        const rows = ids.map(requireRow);

        // `sortOrder` is only ever compared inside a group, so a list spanning
        // two categories would write positions that mean nothing next to each
        // other.
        if (new Set(rows.map((row) => row.parentId)).size > 1) {
            throw new DemoError(ERROR_CODE.VALIDATION, 'a reorder must name one group of siblings', 422);
        }

        for (const [index, row] of rows.entries()) row.sortOrder = index;
        save();
    },
};
