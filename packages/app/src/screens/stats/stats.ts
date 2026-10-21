// The stats screen's arithmetic, in a module with no React Native import so it
// is testable under `bun test`. Every figure is the server's (`stats.trend`,
// `stats.overview`); what happens here is choosing which periods to ask for,
// comparing one point with the one before it, and laying points out.
import { type Locale, localizeCopy, type PaymentMethod } from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';
import { addDays, addMonths, keyParts, offsetForDate, weekdayOf } from '../day/time';
import { type DateRange, FIRST_RECORD, type Period } from './money';

export const METRICS = ['profit', 'revenue', 'cost', 'newPatients'] as const;

export type Metric = (typeof METRICS)[number];

export const METRIC_LABEL: Record<Metric, string> = {
    profit: 'Profit',
    revenue: 'Revenue',
    cost: 'Cost',
    newPatients: 'New patients',
};

/** Which metrics are money, and so drawn with the currency. */
export function isMoney(metric: Metric): boolean {
    return metric !== 'newPatients';
}

type Figures = { revenue: number; cost: number; profit: number; newPatients: number };

export function metricOf(figures: Figures, metric: Metric): number {
    return figures[metric];
}

/** A range as `stats.trend` takes it: whole days, optionally narrowed to minutes of the first and last. */
export type StatsRange = DateRange & { fromMinute?: number; toMinute?: number };

/** One point on the chart: the range it asks the server for and what to call it. */
export type TrendSlot = {
    range: StatsRange;
    /** Under the point on the chart and the branch bar. */
    axis: string;
    /** In the chart's header: "Profit · September". */
    name: string;
};

/** The most years "All time" reaches back; empty ones before the first visit are dropped. */
export const YEARS = 12;

const DAYS = 7;
const WEEKS = 8;
const MONTHS = 6;

const HOUR = 60;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTHS_SHORT = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;

const MONTHS_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

function rangeOf(
    from: string,
    to: string,
    minutes: { fromMinute?: number; toMinute?: number } = {},
): StatsRange {
    // A slot never starts before the first record.
    const start = from < FIRST_RECORD ? FIRST_RECORD : from;
    return {
        from: start,
        to,
        offsetMinutes: offsetForDate(to),
        fromOffsetMinutes: offsetForDate(start),
        ...minutes,
    };
}

function monthEnd(key: string): string {
    return addDays(addMonths(`${key.slice(0, 7)}-01`, 1), -1);
}

/**
 * The points each pill draws, oldest first, the last one being the period the
 * pill names so far: "Today" is the last seven days (closed days at zero),
 * "This week" the last eight weeks from Sunday, "This month" the last six
 * months, "This year" and "All time" one point per year. Like for like, so the
 * bars stand side by side; only the last is cut short at today, and its change
 * chip compares with the same stretch the period before (`comparisonRange`).
 */
export function trendSlots(period: Period, today: string, locale: Locale = getLocale()): TrendSlot[] {
    const say = (copy: string, vars?: Record<string, string | number>) => localizeCopy(locale, copy, vars);
    const month = (key: string) => say(MONTHS_SHORT[keyParts(key).month - 1] ?? '');
    const weekday = (key: string) => say(WEEKDAYS_SHORT[weekdayOf(key)] ?? '');

    if (period === 'today') {
        return Array.from({ length: DAYS }, (_, i) => {
            const back = DAYS - 1 - i;
            const key = addDays(today, -back);
            const label = back === 0 ? say('Today') : weekday(key);
            const name = back === 0 ? label : `${weekday(key)} ${keyParts(key).day} ${month(key)}`;
            return { range: rangeOf(key, key), axis: label, name };
        });
    }

    if (period === 'week') {
        const thisWeek = addDays(today, -weekdayOf(today));
        return Array.from({ length: WEEKS }, (_, i) => {
            const back = WEEKS - 1 - i;
            const start = addDays(thisWeek, -7 * back);
            const end = back === 0 ? today : addDays(start, 6);
            const axis = `${keyParts(start).day} ${month(start)}`;
            return {
                range: rangeOf(start, end),
                axis,
                name: back === 0 ? say('This week') : say('Week of {date}', { date: axis }),
            };
        });
    }

    if (period === 'month') {
        const thisMonth = `${today.slice(0, 7)}-01`;
        return Array.from({ length: MONTHS }, (_, i) => {
            const back = MONTHS - 1 - i;
            const start = addMonths(thisMonth, -back);
            const end = back === 0 ? today : addDays(addMonths(start, 1), -1);
            return {
                range: rangeOf(start, end),
                axis: month(start),
                name: back === 0 ? say('This month') : say(MONTHS_LONG[keyParts(start).month - 1] ?? ''),
            };
        });
    }

    const year = keyParts(today).year;
    return Array.from({ length: YEARS }, (_, i) => {
        const back = YEARS - 1 - i;
        const y = year - back;
        return {
            range: rangeOf(`${y}-01-01`, back === 0 ? today : `${y}-12-31`),
            axis: String(y),
            name: back === 0 ? say('This year') : String(y),
        };
    });
}

/**
 * The same stretch one period back, for the header's change chip: today so far
 * against yesterday up to the same minute, this week so far against last week
 * to the same weekday, and so on. A whole previous month against half of this
 * one would read as a fall every month until the last week. Nothing for "All
 * time", which has nothing before it.
 */
export function comparisonRange(
    period: Period,
    today: string,
    nowMinute: number,
    locale: Locale = getLocale(),
): { range: StatsRange; label: string } | null {
    const say = (copy: string) => localizeCopy(locale, copy);
    const upTo = { toMinute: Math.min(24 * HOUR, nowMinute) };

    if (period === 'today') {
        const day = addDays(today, -1);
        return { range: rangeOf(day, day, upTo), label: say('yesterday') };
    }
    if (period === 'week') {
        const end = addDays(today, -7);
        return { range: rangeOf(addDays(end, -weekdayOf(end)), end, upTo), label: say('last week') };
    }
    if (period === 'month') {
        const start = addMonths(`${today.slice(0, 7)}-01`, -1);
        const sameDay = `${start.slice(0, 7)}-${today.slice(8, 10)}`;
        const end = [sameDay, monthEnd(start)].sort()[0] ?? start;
        return { range: rangeOf(start, end, upTo), label: say('last month') };
    }
    if (period === 'year') {
        const start = `${keyParts(today).year - 1}-01-01`;
        const sameDay = `${start.slice(0, 4)}${today.slice(4)}`;
        const end = [sameDay, monthEnd(`${sameDay.slice(0, 8)}01`)].sort()[0] ?? start;
        return { range: rangeOf(start, end, upTo), label: say('last year') };
    }
    return null;
}

type Point = Figures & { branches: readonly unknown[] };

/**
 * How many leading years to drop: the ones before the clinic's first visit or
 * registration, so "This year" starts where the clinic does rather than with a
 * decade of zeros. The current year always stays.
 */
export function emptyLead(points: readonly Point[]): number {
    let lead = 0;
    while (
        lead < points.length - 1 &&
        points[lead]?.revenue === 0 &&
        points[lead]?.newPatients === 0 &&
        points[lead]?.branches.length === 0
    ) {
        lead++;
    }
    return lead;
}

export type Delta = { percent: number; up: boolean; good: boolean };

/**
 * The selected point against the one before it, as a whole percentage. Nothing
 * when there is nothing before it or it was zero — a rise from nothing is not
 * a percentage. For cost, going down is the good direction.
 */
export function deltaOf(current: number, previous: number | undefined, metric: Metric): Delta | null {
    if (previous === undefined || previous <= 0) return null;
    const percent = Math.round(((current - previous) / previous) * 100);
    const up = percent >= 0;
    return { percent: Math.abs(percent), up, good: metric === 'cost' ? !up || percent === 0 : up };
}

type BranchPoint = { branches: readonly { branchId: string; name: string; profit: number }[] };

/**
 * Every branch any point mentions, the biggest earner first — that one sits at
 * the bottom of each stacked bar, so the bars keep one order across the chart.
 */
export function branchOrder(points: readonly BranchPoint[]): { branchId: string; name: string }[] {
    const total = new Map<string, { branchId: string; name: string; profit: number }>();
    for (const point of points) {
        for (const row of point.branches) {
            const entry = total.get(row.branchId) ?? { branchId: row.branchId, name: row.name, profit: 0 };
            entry.profit += row.profit;
            total.set(row.branchId, entry);
        }
    }
    return [...total.values()]
        .sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name))
        .map(({ branchId, name }) => ({ branchId, name }));
}

/** The branch that brought most of a point's profit, and its share; nothing when there was no profit to share. */
export function leadingShare(point: BranchPoint): { name: string; percent: number; alone: boolean } | null {
    const positive = point.branches.filter((row) => row.profit > 0);
    const total = positive.reduce((sum, row) => sum + row.profit, 0);
    if (total <= 0) return null;
    const lead = positive.reduce((best, row) => (row.profit > best.profit ? row : best));
    // One branch open is not a split: a clinic day belongs to one branch, so a
    // day's "100%" says nothing the bar does not.
    return {
        name: lead.name,
        percent: Math.round((lead.profit / total) * 100),
        alone: point.branches.length === 1,
    };
}

type WorkingBranch = { name: string; profit: number; workingDays: number };

/**
 * Which branch earns more for each day it is open, and by how much, in whole
 * tens of pounds. Per working day because the branches open on different days
 * of the week: the one open more often brings more profit without being the
 * better day. Nothing unless at least two branches were open.
 */
export function perDayLead(point: {
    branches: readonly WorkingBranch[];
}): { best: string; other: string; amount: number } | null {
    const open = point.branches
        .filter((row) => row.workingDays > 0)
        .map((row) => ({ name: row.name, perDay: row.profit / row.workingDays }))
        .sort((a, b) => b.perDay - a.perDay);
    const best = open[0];
    const worst = open[open.length - 1];
    if (!best || !worst || open.length < 2) return null;
    const amount = Math.round((best.perDay - worst.perDay) / 1000) * 1000;
    return amount > 0 ? { best: best.name, other: worst.name, amount } : null;
}

/**
 * A point against the average of the others on the chart, as a whole
 * percentage. Points with no profit at all — a closed day, a year before the
 * clinic — are left out of the average, so a week with a Friday in it is not
 * dragged down by the day nobody worked.
 */
export function versusAverage(
    points: readonly { profit: number }[],
    index: number,
): { percent: number; up: boolean } | null {
    const point = points[index];
    const others = points.filter((row, i) => i !== index && row.profit > 0);
    if (!point || others.length === 0) return null;
    const average = others.reduce((sum, row) => sum + row.profit, 0) / others.length;
    if (average <= 0) return null;
    const percent = Math.round(((point.profit - average) / average) * 100);
    return { percent: Math.abs(percent), up: percent >= 0 };
}

/** Whether any point has two branches in it, and so a split worth tapping for. */
export function hasSplit(points: readonly BranchPoint[]): boolean {
    return points.some((point) => point.branches.length > 1);
}

/**
 * Where each value sits in a `width` × `height` box, left to right, with
 * `pad` kept clear at the sides and `top`/`bottom` for the tag above the
 * selected point and the labels under the axis. The scale is the values' own
 * spread, not zero-based: six months of similar profit drawn from zero is a
 * flat line. One value sits in the middle.
 */
export function chartPoints(
    values: readonly number[],
    box: { width: number; height: number; pad: number; top: number; bottom: number },
): { x: number; y: number }[] {
    const n = values.length;
    if (n === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || Math.max(Math.abs(max), 1);
    const lo = min - spread * 0.15;
    const hi = max + spread * 0.05;
    const base = box.height - box.bottom;
    const x = (i: number) => (n === 1 ? box.width / 2 : box.pad + (i * (box.width - 2 * box.pad)) / (n - 1));
    const y = (v: number) => base - ((v - lo) / (hi - lo)) * (base - box.top);
    return values.map((v, i) => ({ x: x(i), y: y(v) }));
}

/** The methods the payments card draws. "Other" is no longer a way to pay, so it is left off. */
const SHOWN_METHODS: readonly PaymentMethod[] = ['cash', 'visa', 'instapay'];

type Takings = {
    total: number;
    byMethod: readonly { method: PaymentMethod; amount: number; count: number }[];
};

/** The takings without "other", totalled over what is left so the shares add up to 100%. */
export function shownTakings<T extends Takings>(takings: T): T {
    const byMethod = takings.byMethod.filter((row) => SHOWN_METHODS.includes(row.method));
    return { ...takings, byMethod, total: byMethod.reduce((sum, row) => sum + row.amount, 0) };
}
