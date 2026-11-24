import { addDays, offsetForDate, weekdayOf } from '../day/time';

const PIASTRES_PER_EGP = 100;

const COMPACT_FLOOR = 10_000;

export function toEgp(piastres: number): number {
    return Math.round(piastres / PIASTRES_PER_EGP);
}

function group(value: number): string {
    const digits = Math.abs(Math.trunc(value)).toString();
    let out = '';

    for (let i = 0; i < digits.length; i++) {
        if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
        out += digits[i];
    }

    return value < 0 ? `-${out}` : out;
}

function compactEgp(egp: number): string {
    if (Math.abs(egp) < COMPACT_FLOOR) return group(egp);

    const millions = Math.abs(Number((egp / 1_000_000).toFixed(1))) >= 1;
    const [divisor, suffix] = millions ? [1_000_000, 'm'] : [1_000, 'k'];
    const scaled = (egp / divisor).toFixed(1).replace(/\.0$/, '');

    return `${scaled}${suffix}`;
}

export type MoneyLocale = 'en' | 'ar';

export type FormatOptions = {
    compact?: boolean;
    locale?: MoneyLocale;
    showCurrency?: boolean;
};

export function formatEgp(piastres: number, options: FormatOptions = {}): string {
    const { compact = false, locale = 'en', showCurrency = true } = options;

    const egp = toEgp(piastres);
    const figure = compact ? compactEgp(egp) : group(egp);

    if (!showCurrency) return figure;
    return locale === 'ar' ? `${figure} ج.م` : `EGP ${figure}`;
}

export function currencyOf(locale: MoneyLocale): string {
    return locale === 'ar' ? 'ج.م' : 'EGP';
}

export function methodShare(amount: number, total: number): number {
    if (!hasShareBase(total)) return 0;
    return Math.min(1, Math.max(0, amount / total));
}

export function hasShareBase(total: number): boolean {
    return total > 0;
}

export function currencyLeads(locale: MoneyLocale): boolean {
    return locale !== 'ar';
}

export const PERIODS = ['today', 'week', 'month', 'year', 'all'] as const;

export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
    today: 'Today',
    week: 'This week',
    month: 'This month',
    year: 'This year',
    all: 'All time',
};

export type DateRange = {
    from: string;
    to: string;
    offsetMinutes: number;
    fromOffsetMinutes: number;
};

export const FIRST_RECORD = '2000-01-01';

export function periodRange(period: Period, today: string): DateRange {
    const from = periodStart(period, today);

    return {
        from,
        to: today,
        offsetMinutes: offsetForDate(today),
        fromOffsetMinutes: offsetForDate(from),
    };
}

function periodStart(period: Period, today: string): string {
    if (period === 'today') return today;
    if (period === 'week') return addDays(today, -weekdayOf(today));
    if (period === 'month') return `${today.slice(0, 7)}-01`;
    if (period === 'year') return `${today.slice(0, 4)}-01-01`;
    return FIRST_RECORD;
}
