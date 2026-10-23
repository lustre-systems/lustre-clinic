/**
 * What is going to be done, as the booking holds it before anything is written.
 * A visit's procedures are lines with a tooth and a price (§5, §9), and a
 * booking is a plan for exactly those lines — so the draft is shaped like them,
 * and `bookedProcedures` hands the whole list to the appointment, which carries
 * one of its own (it once carried a single `typeId`, and the rest of the plan
 * had to ride along in the note).
 *
 * Grouping is by tooth, not by procedure, because that is how the work is
 * spoken about at the desk and in the chair: "UL6 needs a filling and a
 * cleaning" is one tooth with two lines, and a flat list makes the reader
 * gather them. Lines with no tooth are one group and always sort last — a
 * scaling belongs to the mouth, not to a number.
 *
 * Money is integer piastres end to end (§7.12); nothing here formats it.
 */
import { DECIDUOUS_TEETH, localizeCopy, PERMANENT_TEETH, type Tooth } from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';
import type { Appointment, BookedProcedure, ProcedureCategory } from './data';

export interface PlannedProcedure {
    /** Local to the draft — the row does not exist server-side yet. */
    id: string;
    procedureId: string;
    /** The category as it is read out: "Composite filling". */
    name: string;
    /** The variant under it, when the procedure has one: "Class II". */
    variant: string | null;
    tooth: Tooth | null;
    price: number;
    /** The catalogue's price, which `price` starts at. */
    defaultPrice: number;
    /**
     * Whether `price` is a quote the booking holds. Not the same as differing
     * from `defaultPrice`: the catalogue can move to meet a quote, and the
     * quote must still hold if the catalogue moves on again.
     */
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
    /** Permanent teeth first, then the child's tooth in the same quadrant. */
    codes: Tooth[];
}

/**
 * The chart as it is drawn: upper right runs 8→1 towards the midline, upper
 * left 1→8 away from it, and the lower row mirrors that, so the grid reads
 * like a mouth facing the reader rather than like a sorted list.
 */
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

/**
 * "Upper left · 6" — what the badge cannot fit, said in words. On general
 * procedures nothing is done to a tooth, so a line without one says nothing.
 */
export function toothPosition(tooth: Tooth | null, general = false): string {
    const say = (copy: string) => localizeCopy(getLocale(), copy);
    if (!tooth) return general ? '' : say('No tooth assigned');
    return `${say(QUADRANT_WORDS[tooth.slice(0, 2)] ?? '')} · ${tooth.slice(2)}`;
}

/**
 * The grouping on its own, for lines that carry no price. A booked appointment
 * holds the plan that was agreed, not a bill — the visit snapshots the
 * catalogue on the day — so anything reading a booking has teeth and names and
 * nothing to subtotal, and asking it to invent a price to be grouped would put
 * a number on screen the clinic never quoted.
 */
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

/**
 * The plan as the booking sends it (§7). One line out per line in, never merged
 * into a quantity: two fillings on two teeth are two lines with two teeth, and
 * two on the same tooth are still two things that were agreed to and will be
 * priced one by one at check-in. A price goes only when the desk quoted one —
 * otherwise the visit snapshots the catalogue's on the day, so a price change
 * in between reaches the bill.
 */
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

/** The price a line holds the booking to, or null to bill the catalogue's on the day. */
function quoteOf(procedure: PlannedProcedure): number | null {
    return procedure.quoted || procedure.price !== procedure.defaultPrice ? procedure.price : null;
}

/**
 * A line with its price typed in by hand. Typing the catalogue price back is
 * how the desk takes a quote away.
 */
export function repriced(procedure: PlannedProcedure, price: number): PlannedProcedure {
    return { ...procedure, price, quoted: price !== procedure.defaultPrice };
}

/**
 * What an appointment is booked for, as the plan editor holds it. The heading,
 * the variant and the default price are read off the catalogue — the same place
 * a fresh pick gets them from — and a price quoted at the desk replaces the
 * default, as it did when it was typed.
 */
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

/**
 * A procedure as the catalogue reads it out: its heading, and the variant under
 * it when it is one. The server stores and returns the leaf alone, so "Class II"
 * needs this to read as "Composite filling · Class II" again.
 */
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

/** Whether the plan still says what the appointment is booked for, at the price it was booked at. */
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

/** How a line reads in one string — the confirm step and the note both want it. */
export function describeProcedure(procedure: PlannedProcedure): string {
    const label = procedure.variant ? `${procedure.name} · ${procedure.variant}` : procedure.name;
    return procedure.tooth ? `${label} (${procedure.tooth})` : label;
}

/**
 * Only what can actually go where the secretary is putting it — which depends
 * entirely on whether a tooth has been named yet.
 *
 * With a tooth ("Add to UR6") the list is the procedures done *to* a tooth, and
 * nothing else. A scaling belongs to the mouth; the server refuses it on a
 * tooth (§5 — TOOTH_NOT_APPLICABLE) and offering it here only holds the refusal
 * back until confirm, with the whole plan built and the patient waiting on it.
 * A heading keeps only the variants that fit, and a heading with none left is
 * not a heading worth opening.
 *
 * Without one, the sheet offers the whole catalogue. It used to mirror the
 * strict match and show mouth-level work alone, which dropped every
 * uncategorised tooth-specific procedure — Extraction, Simple extraction — out
 * of a button labelled "Add procedure" with nothing to say where they had
 * gone. The tooth is asked for after the pick instead (`needsTooth` on the
 * chosen row), so the button means what it says and §5 still gets its tooth.
 */
/**
 * The catalogue as a clinic on general procedures sees it: nothing is done to a
 * tooth. The rows keep their own flag on the server, so switching back brings
 * the dental flow back as it was.
 */
export function withoutTeeth(categories: readonly ProcedureCategory[]): ProcedureCategory[] {
    return categories.map((category) => ({
        ...category,
        isToothSpecific: false,
        children: category.children.map((child) => ({ ...child, isToothSpecific: false })),
    }));
}

/**
 * Whether adding starts with the tooth. Only when something on offer is done
 * to one: a catalogue with nothing tooth-specific, which is every catalogue on
 * general procedures, goes straight to the procedure.
 *
 * Before the catalogue arrives a dental clinic starts on the tooth, which needs
 * no catalogue; a general one never does, or the picker would stay up after the
 * catalogue said there was no tooth to ask for.
 */
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

/**
 * Whether the checkup line is being waived on this list — true as soon as any
 * other work is on it. Split out from the sum because the waiver is a fact
 * about the whole visit, not about a group: a tooth's subtotal has to be struck
 * under the same rule the strip uses, or the groups stop adding up to it.
 */
export function checkupIsWaived(lines: readonly Pick<ChargeableLine, 'isCheckup'>[]): boolean {
    return lines.some((line) => !line.isCheckup);
}

/**
 * Σ(unit × quantity), with the checkup line left out once it is waived.
 *
 * Mirrors `computeTotal` in `server/src/util/money.ts` (ported for the demo in
 * `api/demo/rules.ts`), which is the authority: the server prices the visit and
 * the confirmation screen spends `chargedTotal`. The copy exists because the
 * chair and the desk show a running total over lines that have not been written
 * yet, and the day cluster's tests pin the two together.
 */
export function chargeableTotal(lines: readonly ChargeableLine[], waived: boolean): number {
    return lines.reduce(
        (sum, line) => (waived && line.isCheckup ? sum : sum + line.unitPrice * line.quantity),
        0,
    );
}
