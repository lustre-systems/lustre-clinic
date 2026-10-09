/**
 * What the day cluster does with money, which is now only the two rules that
 * are its own. Formatting is `components/domain/money` — §7.12 puts every
 * amount through one implementation, and this file used to hold a second one.
 * The pair is re-exported so the visit screens' string labels keep one import.
 *
 * `amountDue` is the charge less anything already taken; clamping a payment to
 * the charged total would let it be handed over twice, and because
 * `visit.checkOut` does not enforce §7.6, the client stands in front of
 * overpayment. `poundsEntry` sanitises on the way in so a typed `12.5` can
 * never be read as 125 with the field still showing `12.5`.
 *
 * `discountPercent` is presentation only: prices stay whole piastres, and this
 * just says how far a typed price sits under the catalogue's.
 */
import { PAYMENT_METHODS, type PaymentMethod, PIASTRES_PER_POUND } from '@lustre/shared';
import { toPounds } from '../../components/domain/money';
import type { Visit, VisitLine } from './data/types';

export { formatAmount, formatMoney } from '../../components/domain/money';

export function amountDue(chargedTotal: number, alreadyPaid: number): number {
    return Math.max(chargedTotal - alreadyPaid, 0);
}

export function poundsEntry(entry: string): string {
    return entry.replace(/[^\d]/g, '');
}

/**
 * The payment field: the whole pounds it shows, and the exact piastres it
 * records. They differ only for a figure that came from the visit rather than
 * from typing — a 120.50 charge reads `121` and is recorded as 120.50 — so a
 * correction left alone moves nothing, and Full never records over the charge.
 */
export interface PaidEntry {
    text: string;
    piastres: number;
}

export function paidEntry(piastres: number): PaidEntry {
    return { text: String(toPounds(piastres)), piastres };
}

/** Typed pounds, capped at `ceiling`. `capped` is the screen's cue to say so. */
export function typedEntry(typed: string, ceiling: number): { entry: PaidEntry; capped: boolean } {
    const digits = poundsEntry(typed);
    const piastres = digits ? Number(digits) * PIASTRES_PER_POUND : 0;
    if (piastres > ceiling) return { entry: paidEntry(ceiling), capped: true };
    return { entry: { text: digits, piastres }, capped: false };
}

/**
 * Full, Half and Nothing, measured against `ceiling` — the most the field may
 * hold. At the desk that is what is still due, and the chips are shares of the
 * money being handed over now. On a correction it is the whole charge, and they
 * are states of the bill: paid in full, half paid, unpaid. They were read off
 * what was left on top of what had been paid, which on a visit already paid in
 * full is nothing — so all three landed on the same figure and none applied.
 */
export function quickAmounts(ceiling: number): { full: number; half: number; nothing: number } {
    const top = Math.max(ceiling, 0);
    return { full: top, half: Math.round(top / 2), nothing: 0 };
}

/**
 * How much under `procedureTotal` (a procedure's default price) `charged` is, as
 * a whole percent — or null when there is nothing to show: no discount, or no
 * default to measure one against. A discount that is some but not all of the
 * price never rounds to 0% or 100%, which would read as none or everything.
 */
export function discountPercent(procedureTotal: number, charged: number): number | null {
    if (!Number.isFinite(procedureTotal) || !Number.isFinite(charged) || procedureTotal <= 0) return null;
    const off = procedureTotal - Math.max(charged, 0);
    if (off <= 0) return null;
    if (off >= procedureTotal) return 100;
    return Math.min(Math.max(Math.round((off / procedureTotal) * 100), 1), 99);
}

/**
 * How far the procedures came in under the catalogue, together: `usual` is
 * what they cost at the defaults, and `off` is how much less they are charged
 * at. A line priced above its default counts against a line priced under
 * one, so a visit charged more than its usual total shows no discount at all.
 * A line whose default is unknown counts at its own price on both sides. Null
 * when nothing is off.
 */
export function procedureDiscount(
    lines: ReadonlyArray<{ procedureId: string; unitPrice: number; quantity: number }>,
    defaults: ReadonlyMap<string, number>,
): { off: number; usual: number; percent: number } | null {
    let usual = 0;
    let charged = 0;
    for (const line of lines) {
        usual += (defaults.get(line.procedureId) ?? line.unitPrice) * line.quantity;
        charged += line.unitPrice * line.quantity;
    }
    const percent = discountPercent(usual, charged);
    return percent === null ? null : { off: usual - charged, usual, percent };
}

export interface PaidBy {
    method: PaymentMethod;
    methodNote: string | null;
    amount: number;
}

/**
 * How the money on a visit was paid, net of its corrections: one entry per
 * method still holding any, `other` once per note, largest first. Empty when
 * nothing is paid. A method the enum does not know reads as `other`.
 */
export function paidBy(
    payments: ReadonlyArray<{ amount: number; method: string; methodNote: string | null }>,
): PaidBy[] {
    const nets = new Map<string, PaidBy>();
    for (const payment of payments) {
        const method = (PAYMENT_METHODS as readonly string[]).includes(payment.method)
            ? (payment.method as PaymentMethod)
            : 'other';
        const methodNote = method === 'other' ? (payment.methodNote?.trim() ?? null) : null;
        const key = method === 'other' ? `other:${methodNote ?? ''}` : method;
        const net = nets.get(key);
        if (net) net.amount += payment.amount;
        else nets.set(key, { method, methodNote, amount: payment.amount });
    }
    return [...nets.values()].filter((net) => net.amount > 0).sort((a, b) => b.amount - a.amount);
}

/** Whether `held` is already all in `method` — restating it would write nothing. */
export function alreadyPaidBy(held: readonly PaidBy[], method: PaymentMethod, methodNote: string): boolean {
    const [only, ...rest] = held;
    if (!only || rest.length > 0 || only.method !== method) return false;
    return method !== 'other' || (only.methodNote ?? '') === methodNote.trim();
}

export interface PricedLine extends VisitLine {
    unitPrice: number;
    lineTotal: number;
}

export interface PricedVisit extends Visit {
    chargedTotal: number;
    computedTotal: number;
    procedures: PricedLine[];
}

/**
 * The visit with its amounts, or null when this phone is not shown them: the
 * server withholds a finished visit's charge and prices from a doctor's phone.
 * The screens that price or take money are only for a visit that has them.
 */
export function pricedVisit(visit: Visit): PricedVisit | null {
    const { chargedTotal, computedTotal } = visit;
    if (chargedTotal === null || computedTotal === null) return null;
    const procedures: PricedLine[] = [];
    for (const line of visit.procedures) {
        if (line.unitPrice === null || line.lineTotal === null) return null;
        procedures.push({ ...line, unitPrice: line.unitPrice, lineTotal: line.lineTotal });
    }
    return { ...visit, chargedTotal, computedTotal, procedures };
}
