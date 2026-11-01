// Money formatting and period ranges for the cluster, in a module with no React
// Native import so it is testable under `bun test`. §7.12: integer piastres end
// to end, formatted at the edge in `MoneyValue` only. `toEgp` rounds rather
// than truncates so a figure carrying piastres reads as the nearer pound, never
// less than is owed. Grouping is written out rather than taken from `Intl`,
// which Hermes ships in varying completeness and which would group by device
// locale where §7.11 wants one grouping in both languages.
//
// The payment-entry rules that lived here — the whole-pounds guard and the
// overpayment clamp — went to `screens/patients/components/money.ts` with the
// sheet. Nothing on the dashboard takes money.
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

/**
 * One payment method's share of the period's takings.
 *
 * A share only exists against a positive base. A refund is a negative payment
 * row (`payments_amount_nonzero` allows it; `visit.setPaid` writes one whenever
 * a paid total is corrected downward), so a method's total can be negative and
 * the period's total can net to zero or below. None of those are a length of
 * bar: a negative share draws a bar backwards out of its track and labels it
 * "-33%", and dividing by a zero or negative total is not a percentage of
 * anything, so the share is clamped to 0–1.
 *
 * `hasShareBase` is the question the card has to ask *before* this: a period
 * with rows but no positive total has amounts worth showing and no split worth
 * drawing.
 */
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

// `balance.summary` and `balance.takings` take a closed range, so "All time"
// needs a floor rather than an open start. No clinic record predates this.
export const FIRST_RECORD = '2000-01-01';

/**
 * The pills, as the two range queries want them: local `YYYY-MM-DD` days plus
 * the offset the server derives the boundaries with. `to` is inclusive, so
 * every period ends today rather than at the end of the calendar unit — a
 * "This year" that ran to December would be counting a future nobody has
 * charged yet.
 *
 * `today` is passed in rather than read from the clock here. The Money tab is
 * mounted once and hidden rather than unmounted, so a screen that captured the
 * day at first render would still be asking for it days later; taking it as an
 * argument is what lets the caller re-read it, and what makes this testable
 * without faking a clock.
 *
 * The week starts Sunday: Egypt's weekend is Friday and Saturday, so Sunday is
 * the first working day, and a week that began on Saturday would open on the
 * weekend. This matches `Date#getDay` and `clinic_days.weekday`.
 *
 * Each end carries the offset in force on its own day, because Egypt keeps DST
 * and a range can start in the other regime — "This year" does, every year,
 * from the changeover in April until the one in October. One offset for both
 * ends applied a summer +03:00 to 1 January and opened the window an hour
 * before local midnight, which counted the last hour of 31 December as part of
 * the new year. The server compares a timestamp against the boundary, not a day
 * bucket, so the hour is really in or really out.
 */
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
