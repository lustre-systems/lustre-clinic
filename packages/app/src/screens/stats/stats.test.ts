import { describe, expect, it } from 'bun:test';
import {
    branchOrder,
    chartPoints,
    comparisonRange,
    deltaOf,
    emptyLead,
    leadingShare,
    shownTakings,
    trendSlots,
    YEARS,
} from './stats';

// A Wednesday.
const TODAY = '2026-10-14';

describe('the points inside each pill', () => {
    it('is today by the hour, up to the hour it is now', () => {
        const slots = trendSlots('today', TODAY, 'en', 10 * 60 + 15);
        expect(slots).toHaveLength(11);
        expect(slots.at(-1)?.range).toMatchObject({ from: TODAY, to: TODAY, fromMinute: 600, toMinute: 660 });
        expect(slots.at(-1)?.axis).toBe('10AM');
        expect(slots[0]?.name).toBe('12 AM');
    });

    it('is this week by the day, from Sunday to today', () => {
        const slots = trendSlots('week', TODAY);
        expect(slots.map((slot) => slot.axis)).toEqual(['Sun', 'Mon', 'Tue', 'Wed']);
        expect(slots[0]?.range).toMatchObject({ from: '2026-10-11', to: '2026-10-11' });
        expect(slots.at(-1)?.name).toBe('Today');
    });

    it('is this month by Sunday weeks, cut at the month and at today', () => {
        const slots = trendSlots('month', TODAY);
        expect(slots.map((slot) => slot.axis)).toEqual(['1–3', '4–10', '11–14']);
        expect(slots[1]?.range).toMatchObject({ from: '2026-10-04', to: '2026-10-10' });
        expect(slots[1]?.name).toBe('4–10 Oct');
    });

    it('is this year by the month, the last running to today', () => {
        const slots = trendSlots('year', TODAY);
        expect(slots).toHaveLength(10);
        expect(slots[8]?.range).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
        expect(slots[8]?.name).toBe('September');
        expect(slots.at(-1)?.range).toMatchObject({ from: '2026-10-01', to: TODAY });
    });

    it('is all time by the year', () => {
        const slots = trendSlots('all', TODAY);
        expect(slots).toHaveLength(YEARS);
        expect(slots.at(-2)?.range).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    });

    it('names the points in the language asked for, whatever the screen was drawn in first', () => {
        expect(trendSlots('week', TODAY, 'ar').at(-1)?.name).toBe('اليوم');
        expect(trendSlots('month', TODAY, 'ar')[1]?.name).not.toContain('Oct');
    });

    it('carries the offset of each end’s own day, as the server wants', () => {
        // Egypt keeps DST: January is +02:00 and October 14 still +03:00.
        const range = trendSlots('all', TODAY).at(-1)?.range;
        expect(range?.fromOffsetMinutes).toBe(120);
        expect(range?.offsetMinutes).toBe(180);
    });
});

describe('the same stretch the period before', () => {
    const now = 10 * 60;

    it('is yesterday up to this minute, for today', () => {
        expect(comparisonRange('today', TODAY, now)?.range).toMatchObject({
            from: '2026-10-13',
            to: '2026-10-13',
            toMinute: now,
        });
    });

    it('is last week from Sunday to the same weekday', () => {
        expect(comparisonRange('week', TODAY, now)?.range).toMatchObject({
            from: '2026-10-04',
            to: '2026-10-07',
        });
    });

    it('is last month to the same day, cut at the month’s end', () => {
        expect(comparisonRange('month', TODAY, now)?.range).toMatchObject({
            from: '2026-09-01',
            to: '2026-09-14',
        });
        expect(comparisonRange('month', '2026-03-31', now)?.range).toMatchObject({
            from: '2026-02-01',
            to: '2026-02-28',
        });
    });

    it('is last year to the same date', () => {
        expect(comparisonRange('year', TODAY, now)?.range).toMatchObject({
            from: '2025-01-01',
            to: '2025-10-14',
        });
        expect(comparisonRange('year', TODAY, now)?.label).toBe('last year');
    });

    it('is nothing for all time', () => {
        expect(comparisonRange('all', TODAY, now)).toBeNull();
    });
});

describe('years before the clinic’s first', () => {
    const empty = { revenue: 0, cost: 0, profit: 0, newPatients: 0, branches: [] };
    const busy = { revenue: 10, cost: 0, profit: 10, newPatients: 1, branches: [{}] };

    it('are dropped from the front only', () => {
        expect(emptyLead([empty, empty, busy, empty, busy])).toBe(2);
    });

    it('never drop the current year', () => {
        expect(emptyLead([empty, empty, empty])).toBe(2);
    });
});

describe('the change on the point before', () => {
    it('is a whole percentage, good when it went up', () => {
        expect(deltaOf(112, 100, 'profit')).toEqual({ percent: 12, up: true, good: true });
        expect(deltaOf(88, 100, 'revenue')).toEqual({ percent: 12, up: false, good: false });
    });

    it('is good for cost when it went down', () => {
        expect(deltaOf(80, 100, 'cost')?.good).toBe(true);
        expect(deltaOf(120, 100, 'cost')?.good).toBe(false);
    });

    it('is nothing from zero or with nothing before', () => {
        expect(deltaOf(50, 0, 'profit')).toBeNull();
        expect(deltaOf(50, undefined, 'profit')).toBeNull();
    });
});

describe('branches', () => {
    const point = (maadi: number, zamalek: number) => ({
        branches: [
            { branchId: 'z', name: 'Zamalek', profit: zamalek },
            { branchId: 'm', name: 'Maadi', profit: maadi },
        ],
    });

    it('stack the biggest earner at the bottom, in one order across the chart', () => {
        expect(branchOrder([point(60, 40), point(50, 30)]).map((b) => b.name)).toEqual(['Maadi', 'Zamalek']);
    });

    it('say who brought most of a point’s profit', () => {
        expect(leadingShare(point(62, 38))).toEqual({ name: 'Maadi', percent: 62 });
        expect(leadingShare(point(0, 0))).toBeNull();
    });

    it('leave a branch that lost money out of the share', () => {
        expect(leadingShare(point(100, -40))).toEqual({ name: 'Maadi', percent: 100 });
    });
});

describe('laying the chart out', () => {
    const box = { width: 326, height: 120, pad: 18, top: 28, bottom: 30 };

    it('spreads the points across the width and puts the highest at the top', () => {
        const points = chartPoints([10, 30, 20], box);
        expect(points.map((p) => p.x)).toEqual([18, 163, 308]);
        const [low, high, mid] = points.map((p) => p.y);
        expect(high).toBeLessThan(mid ?? 0);
        expect(mid).toBeLessThan(low ?? 0);
        expect(high).toBeGreaterThanOrEqual(box.top);
        expect(low).toBeLessThanOrEqual(box.height - box.bottom);
    });

    it('puts one point in the middle and draws equal values level', () => {
        expect(chartPoints([5], box)[0]?.x).toBe(163);
        const flat = chartPoints([0, 0, 0], box).map((p) => p.y);
        expect(new Set(flat).size).toBe(1);
    });
});

describe('how people pay', () => {
    it('leaves "other" off and totals what is left, so the shares add up', () => {
        const shown = shownTakings({
            total: 1_000,
            byMethod: [
                { method: 'cash' as const, amount: 600, count: 3 },
                { method: 'other' as const, amount: 100, count: 1 },
                { method: 'visa' as const, amount: 300, count: 2 },
            ],
        });
        expect(shown.byMethod.map((row) => row.method)).toEqual(['cash', 'visa']);
        expect(shown.total).toBe(900);
    });
});
