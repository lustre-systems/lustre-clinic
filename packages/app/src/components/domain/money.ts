import type { Locale } from '@lustre/shared';
import { PIASTRES_PER_POUND } from '@lustre/shared';

export const CURRENCY: Record<Locale, string> = { en: 'EGP', ar: 'ج.م' };

const COMPACT_FLOOR = 10_000;

export type MoneyOptions = { compact?: boolean; language?: Locale };

export function toPounds(piastres: number): number {
    const magnitude = Math.round(Math.abs(piastres) / PIASTRES_PER_POUND);
    return piastres < 0 ? -magnitude : magnitude;
}

export function formatAmount(piastres: number, compact = false): string {
    const pounds = toPounds(piastres);
    const magnitude = Math.abs(pounds);
    const grouped = compact ? compactPounds(magnitude) : group(magnitude);
    return pounds < 0 && magnitude > 0 ? `-${grouped}` : grouped;
}

export function formatMoney(piastres: number, options: MoneyOptions = {}): string {
    const language = options.language ?? 'en';
    const amount = formatAmount(piastres, options.compact);
    return language === 'ar' ? `${amount} ${CURRENCY.ar}` : `${CURRENCY.en} ${amount}`;
}

function group(magnitude: number): string {
    return String(magnitude).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function compactPounds(magnitude: number): string {
    if (magnitude >= 1_000_000) return `${trim(magnitude / 1_000_000)}m`;
    if (magnitude >= COMPACT_FLOOR) return `${trim(magnitude / 1_000)}k`;
    return group(magnitude);
}

function trim(value: number): string {
    return value.toFixed(1).replace(/\.0$/, '');
}

export function sanitisePounds(text: string): string {
    return text.replace(/[^0-9]/g, '');
}

export function poundsToPiastres(pounds: string): number {
    const digits = sanitisePounds(pounds);
    return digits ? Number(digits) * PIASTRES_PER_POUND : 0;
}
