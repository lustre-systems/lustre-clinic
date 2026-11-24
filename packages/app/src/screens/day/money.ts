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

export interface PaidEntry {
    text: string;
    piastres: number;
}

export function paidEntry(piastres: number): PaidEntry {
    return { text: String(toPounds(piastres)), piastres };
}

export function typedEntry(typed: string, ceiling: number): { entry: PaidEntry; capped: boolean } {
    const digits = poundsEntry(typed);
    const piastres = digits ? Number(digits) * PIASTRES_PER_POUND : 0;
    if (piastres > ceiling) return { entry: paidEntry(ceiling), capped: true };
    return { entry: { text: digits, piastres }, capped: false };
}

export function quickAmounts(ceiling: number): { full: number; half: number; nothing: number } {
    const top = Math.max(ceiling, 0);
    return { full: top, half: Math.round(top / 2), nothing: 0 };
}

export function discountPercent(procedureTotal: number, charged: number): number | null {
    if (!Number.isFinite(procedureTotal) || !Number.isFinite(charged) || procedureTotal <= 0) return null;
    const off = procedureTotal - Math.max(charged, 0);
    if (off <= 0) return null;
    if (off >= procedureTotal) return 100;
    return Math.min(Math.max(Math.round((off / procedureTotal) * 100), 1), 99);
}

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
