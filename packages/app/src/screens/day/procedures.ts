import { DECIDUOUS_TEETH, localizeCopy, PERMANENT_TEETH, type Tooth } from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';
import type { Appointment, BookedProcedure, ProcedureCategory } from './data';

export interface PlannedProcedure {
    id: string;
    procedureId: string;
    name: string;
    variant: string | null;
    tooth: Tooth | null;
    price: number;
    defaultPrice: number;
    quoted: boolean;
}

export interface ToothGroup {
    tooth: Tooth | null;
    items: PlannedProcedure[];
    subtotal: number;
}

const QUADRANT_WORDS: Record<string, string> = {
    UR: 'Upper right',
    UL: 'Upper left',
    LL: 'Lower left',
    LR: 'Lower right',
};

export interface Quadrant {
    key: string;
    name: string;
    codes: Tooth[];
}

export const QUADRANTS: Quadrant[] = ['UR', 'UL', 'LL', 'LR'].map((key) => {
    const permanent = PERMANENT_TEETH.filter((code) => code.startsWith(key));
    const deciduous = DECIDUOUS_TEETH.filter((code) => code.startsWith(key));
    const ordered = key === 'UR' || key === 'LR' ? [...permanent].reverse() : permanent;

    return {
        key,
        name: `${QUADRANT_WORDS[key]} · ${key}`,
        codes: [...ordered, ...deciduous] as Tooth[],
    };
});

const TOOTH_ORDER = new Map<string, number>(
    QUADRANTS.flatMap((quadrant, index) =>
        quadrant.codes.map((code, at) => [code, index * 100 + at] as const),
    ),
);

export function toothPosition(tooth: Tooth | null, general = false): string {
    const say = (copy: string) => localizeCopy(getLocale(), copy);
    if (!tooth) return general ? '' : say('No tooth assigned');
    return `${say(QUADRANT_WORDS[tooth.slice(0, 2)] ?? '')} · ${tooth.slice(2)}`;
}

export function toothGroupsOf<T extends { tooth: Tooth | null }>(
    procedures: readonly T[],
): Array<{ tooth: Tooth | null; items: T[] }> {
    const groups = new Map<string, T[]>();
    for (const procedure of procedures) {
        const key = procedure.tooth ?? '';
        groups.set(key, [...(groups.get(key) ?? []), procedure]);
    }

    return [...groups.entries()]
        .sort(([a], [b]) => {
            if (a === '') return 1;
            if (b === '') return -1;
            return (TOOTH_ORDER.get(a) ?? 0) - (TOOTH_ORDER.get(b) ?? 0);
        })
        .map(([tooth, items]) => ({ tooth: (tooth || null) as Tooth | null, items }));
}

export function groupByTooth(procedures: readonly PlannedProcedure[]): ToothGroup[] {
    return toothGroupsOf(procedures).map((group) => ({ ...group, subtotal: totalOf(group.items) }));
}

export function totalOf(procedures: readonly PlannedProcedure[]): number {
    return procedures.reduce((sum, procedure) => sum + procedure.price, 0);
}

export function bookedProcedures(plan: readonly PlannedProcedure[]): BookedProcedure[] {
    return plan.map((procedure) => {
        const quotedPrice = quoteOf(procedure);
        return {
            procedureId: procedure.procedureId,
            tooth: procedure.tooth,
            ...(quotedPrice === null ? {} : { quotedPrice }),
        };
    });
}

function quoteOf(procedure: PlannedProcedure): number | null {
    return procedure.quoted || procedure.price !== procedure.defaultPrice ? procedure.price : null;
}

export function repriced(procedure: PlannedProcedure, price: number): PlannedProcedure {
    return { ...procedure, price, quoted: price !== procedure.defaultPrice };
}

export function planFrom(
    booked: Appointment['procedures'],
    categories: readonly ProcedureCategory[],
): PlannedProcedure[] {
    return booked.map((line) => {
        const found = headingOf(line.procedureId, categories);
        const defaultPrice = found?.defaultPrice ?? 0;
        return {
            id: line.id,
            procedureId: line.procedureId,
            tooth: line.tooth,
            name: found?.name ?? line.name,
            variant: found?.variant ?? null,
            price: line.quotedPrice ?? defaultPrice,
            defaultPrice,
            quoted: line.quotedPrice !== null,
        };
    });
}

export function headingOf(
    procedureId: string,
    categories: readonly ProcedureCategory[],
): { name: string; variant: string | null; defaultPrice: number } | null {
    for (const category of categories) {
        if (category.id === procedureId) {
            return { name: category.name, variant: null, defaultPrice: category.defaultPrice };
        }
        const child = category.children.find((row) => row.id === procedureId);
        if (child) return { name: category.name, variant: child.name, defaultPrice: child.defaultPrice };
    }
    return null;
}

export function samePlan(plan: readonly PlannedProcedure[], booked: Appointment['procedures']): boolean {
    return (
        plan.length === booked.length &&
        plan.every((line, i) => {
            const was = booked[i];
            return (
                line.procedureId === was?.procedureId &&
                line.tooth === (was.tooth ?? null) &&
                quoteOf(line) === was.quotedPrice
            );
        })
    );
}

export function describeProcedure(procedure: PlannedProcedure): string {
    const label = procedure.variant ? `${procedure.name} · ${procedure.variant}` : procedure.name;
    return procedure.tooth ? `${label} (${procedure.tooth})` : label;
}

export function withoutTeeth(categories: readonly ProcedureCategory[]): ProcedureCategory[] {
    return categories.map((category) => ({
        ...category,
        isToothSpecific: false,
        children: category.children.map((child) => ({ ...child, isToothSpecific: false })),
    }));
}

export function asksTooth(categories: readonly ProcedureCategory[] | undefined, general = false): boolean {
    if (general) return false;
    if (!categories) return true;
    return categories.some(
        (category) => category.isToothSpecific || category.children.some((child) => child.isToothSpecific),
    );
}

export function offeredFor(categories: readonly ProcedureCategory[], hasTooth: boolean): ProcedureCategory[] {
    if (!hasTooth) return [...categories];

    return categories.flatMap((category) => {
        if (category.selectable) {
            return category.isToothSpecific ? [category] : [];
        }

        const children = category.children.filter((child) => child.isToothSpecific);
        return children.length > 0 ? [{ ...category, children }] : [];
    });
}

export interface ChargeableLine {
    unitPrice: number;
    quantity: number;
    isCheckup: boolean;
}

export function checkupIsWaived(lines: readonly Pick<ChargeableLine, 'isCheckup'>[]): boolean {
    return lines.some((line) => !line.isCheckup);
}

export function chargeableTotal(lines: readonly ChargeableLine[], waived: boolean): number {
    return lines.reduce(
        (sum, line) => (waived && line.isCheckup ? sum : sum + line.unitPrice * line.quantity),
        0,
    );
}
