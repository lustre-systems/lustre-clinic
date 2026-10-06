// Wrong numbers on the money screens are worse than missing ones, and `bun
// test` has no renderer, so what is tested here is everything that decides a
// figure: the piastre-to-pound conversion, the compact form, the currency
// rule, the overpayment clamp, and the derivations the screens trust.
//
// The derived balances themselves are no longer asserted here. They were, back
// when `_LocalMoneyApi` derived them from fixtures on the client; the server
// derives them now, and `packages/server/tests/balance.test.ts` and
// `modules.test.ts` assert them against real Postgres. Testing a mirrored copy
// of that arithmetic would only prove the copy agreed with itself.
import { describe, expect, it } from 'bun:test';
import { offsetForDate } from '../day/time';
import {
    dueLabel,
    methodLabel,
    outstandingAge,
    paymentMethodOf,
    statsPeriodLabel,
    takingsLabel,
} from './format';
import {
    amountStillDue,
    collectedAhead,
    collectionRate,
    currencyLeads,
    DEBTOR_SORT_LABEL,
    DEBTOR_SORTS,
    formatEgp,
    hasShareBase,
    methodShare,
    PERIOD_LABEL,
    PERIODS,
    periodRange,
    sortDebtors,
    toEgp,
} from './money';

describe('piastres to pounds (§7.12)', () => {
    it('never shows piastres', () => {
        expect(toEgp(260_000)).toBe(2_600);
        expect(toEgp(0)).toBe(0);
    });

    it('rounds a part-pound to the nearer pound rather than dropping it', () => {
        expect(toEgp(12_050)).toBe(121);
        expect(toEgp(12_049)).toBe(120);
    });
});

describe('formatting', () => {
    it('groups thousands', () => {
        expect(formatEgp(260_000)).toBe('EGP 2,600');
        expect(formatEgp(1_000_000)).toBe('EGP 10,000');
        expect(formatEgp(90_000)).toBe('EGP 900');
    });

    it('puts the currency first in English and last in Arabic (§7.13)', () => {
        expect(formatEgp(260_000, { locale: 'en' })).toBe('EGP 2,600');
        expect(formatEgp(260_000, { locale: 'ar' })).toBe('2,600 ج.م');
    });

    it('keeps Latin numerals in Arabic (§7.11)', () => {
        expect(formatEgp(260_000, { locale: 'ar' })).toContain('2,600');
    });

    it('omits the currency when asked', () => {
        expect(formatEgp(260_000, { showCurrency: false })).toBe('2,600');
    });

    it('handles zero', () => {
        expect(formatEgp(0)).toBe('EGP 0');
    });
});

describe('compact form — hero and stat cards only (§7.12)', () => {
    it('is the design figure', () => {
        expect(formatEgp(14_262_000, { compact: true })).toBe('EGP 142.6k');
    });

    it('leaves four-digit amounts alone, where compact would lose more than it saves', () => {
        expect(formatEgp(999_900, { compact: true })).toBe('EGP 9,999');
        expect(formatEgp(1_000_000, { compact: true })).toBe('EGP 10k');
    });

    it('drops a trailing .0', () => {
        expect(formatEgp(2_500_000, { compact: true })).toBe('EGP 25k');
    });

    it('promotes to millions instead of reading 1000k', () => {
        expect(formatEgp(99_995_000, { compact: true })).toBe('EGP 1m');
        expect(formatEgp(120_000_000, { compact: true })).toBe('EGP 1.2m');
    });
});

// Overpayment and the whole-pounds guard moved to `patients.test.ts` with the
// payment sheet — this cluster no longer takes money, so it no longer has an
// amount to clamp.

describe('outstanding age', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');

    it('counts whole days, then coarsens', () => {
        expect(outstandingAge('2026-08-09T09:00:00.000Z', now)).toBe('today');
        expect(outstandingAge('2026-08-08T09:00:00.000Z', now)).toBe('1 day');
        expect(outstandingAge('2026-07-28T09:00:00.000Z', now)).toBe('12 days');
        expect(outstandingAge('2026-05-02T09:00:00.000Z', now)).toBe('3 months');
        expect(outstandingAge('2025-01-14T09:00:00.000Z', now)).toBe('1 year');
    });
});

describe('the period pills, as a range the server can answer', () => {
    // A Wednesday, so the week start is four days back and not the same day.
    const today = '2026-08-19';

    it('ends every period today rather than at the end of the calendar unit', () => {
        for (const period of PERIODS) {
            expect(periodRange(period, today).to).toBe(today);
        }
    });

    it('starts today on today', () => {
        expect(periodRange('today', today).from).toBe('2026-08-19');
    });

    it('starts the week on Sunday, the first working day', () => {
        expect(periodRange('week', today).from).toBe('2026-08-16');
    });

    it('starts the week on the day itself when the day is a Sunday', () => {
        expect(periodRange('week', '2026-08-16').from).toBe('2026-08-16');
    });

    it('starts the month on the first and the year on 1 January', () => {
        expect(periodRange('month', today).from).toBe('2026-08-01');
        expect(periodRange('year', today).from).toBe('2026-01-01');
    });

    it('crosses a month and a year boundary without arithmetic on the wrong unit', () => {
        expect(periodRange('month', '2026-01-01').from).toBe('2026-01-01');
        expect(periodRange('week', '2026-01-01').from).toBe('2025-12-28');
        expect(periodRange('year', '2026-12-31').from).toBe('2026-01-01');
    });

    it('floors all time, because the server takes a closed range', () => {
        const range = periodRange('all', today);

        expect(range.from).toBe('2000-01-01');
        expect(range.from < range.to).toBe(true);
    });

    it('never starts a period after it ends', () => {
        for (const period of PERIODS) {
            const range = periodRange(period, today);
            expect(range.from <= range.to).toBe(true);
        }
    });

    // The Money tab is never unmounted, so the day it measures from has to be
    // an argument. A screen holding yesterday must produce yesterday's range —
    // that is what makes the staleness visible instead of silent.
    it('follows the day it is given, so a re-read moves the whole range', () => {
        expect(periodRange('today', '2026-08-19').from).toBe('2026-08-19');
        expect(periodRange('today', '2026-08-20').from).toBe('2026-08-20');

        const newMonth = periodRange('month', '2026-09-01');
        expect(newMonth.from).toBe('2026-09-01');
        expect(newMonth.to).toBe('2026-09-01');
    });

    // Egypt keeps DST, so a range starting in the other regime has two offsets.
    // The server expands each end with the one it is given, and one offset for
    // both opened "This year" an hour before local midnight on 1 January.
    // Asserted as the wiring rather than as a figure: under CI's UTC both
    // offsets are zero, and it is which day each is read from that was wrong.
    it('carries the offset in force at each end of the range', () => {
        for (const period of PERIODS) {
            const range = periodRange(period, today);

            expect(range.offsetMinutes).toBe(offsetForDate(range.to));
            expect(range.fromOffsetMinutes).toBe(offsetForDate(range.from));
        }
    });

    it('labels every period it can produce', () => {
        for (const period of PERIODS) {
            expect(PERIOD_LABEL[period]).toBeTruthy();
        }
    });
});

describe('a refund makes a takings row negative (§10)', () => {
    // `visit.setPaid` writes the delta, so correcting a paid total downwards
    // inserts a negative payment. Every case below is reachable from the desk.
    it('takes an ordinary share as before', () => {
        expect(methodShare(50_000, 200_000)).toBe(0.25);
        expect(methodShare(200_000, 200_000)).toBe(1);
    });

    it('never draws a bar backwards for a method that refunded more than it took', () => {
        expect(methodShare(-50_000, 150_000)).toBe(0);
        expect(Math.round(methodShare(-50_000, 150_000) * 100)).toBe(0);
    });

    it('has no share to take when the period netted to zero or below', () => {
        expect(hasShareBase(0)).toBe(false);
        expect(hasShareBase(-120_000)).toBe(false);
        expect(methodShare(100_000, 0)).toBe(0);
        expect(methodShare(-120_000, -120_000)).toBe(0);
    });

    it('still has a base when the period is positive', () => {
        expect(hasShareBase(1)).toBe(true);
    });

    it('caps a share at the whole, so a bar cannot overrun its track', () => {
        expect(methodShare(300_000, 200_000)).toBe(1);
    });
});

describe('a payment method the enum does not know', () => {
    // `visit.byId` widens the column to `string`, so the narrowing is the
    // client's and a blank row is the failure it is there to avoid.
    it('keeps every real method', () => {
        expect(paymentMethodOf('cash')).toBe('cash');
        expect(paymentMethodOf('visa')).toBe('visa');
        expect(paymentMethodOf('instapay')).toBe('instapay');
        expect(paymentMethodOf('other')).toBe('other');
    });

    it('falls back rather than rendering nothing', () => {
        expect(paymentMethodOf('cheque')).toBe('other');
        expect(methodLabel('cheque')).toBe('Other');
    });

    it('labels a method the enum does not know as Other', () => {
        expect(methodLabel('cash')).toBe('Cash');
        expect(methodLabel('visa')).toBe('Card');
    });
});

describe('a period can collect more than it charged', () => {
    const quietDay = { charged: 40_000, collected: 160_000, difference: -120_000 };

    it('never draws a negative amount due (§7.6)', () => {
        expect(amountStillDue(quietDay.difference)).toBe(0);
        expect(formatEgp(amountStillDue(quietDay.difference))).toBe('EGP 0');
    });

    it('caps the collection rate at 100%, so the split bar has somewhere to put it', () => {
        expect(collectionRate(quietDay.charged, quietDay.collected)).toBe(1);
        expect(collectionRate(240_000, 120_000)).toBe(0.5);
    });

    it('reports what was collected against earlier visits rather than hiding it', () => {
        expect(collectedAhead(quietDay.difference)).toBe(120_000);
        expect(collectedAhead(50_000)).toBe(0);
    });

    it('treats a period that charged nothing as fully collected', () => {
        expect(collectionRate(0, 0)).toBe(1);
        expect(collectionRate(0, 90_000)).toBe(1);
    });

    it('leaves an ordinary period untouched', () => {
        expect(amountStillDue(2_382_000)).toBe(2_382_000);
        expect(collectedAhead(2_382_000)).toBe(0);
        expect(Math.round(collectionRate(14_262_000, 11_880_000) * 100)).toBe(83);
    });
});

describe('currency position (§7.13)', () => {
    it('leads in English and trails in Arabic', () => {
        expect(currencyLeads('en')).toBe(true);
        expect(currencyLeads('ar')).toBe(false);
    });

    it('agrees with the single-string form, which is the reference order', () => {
        for (const locale of ['en', 'ar'] as const) {
            const whole = formatEgp(260_000, { locale });
            const figure = formatEgp(260_000, { locale, showCurrency: false });
            const currency = locale === 'ar' ? 'ج.م' : 'EGP';

            expect(whole).toBe(currencyLeads(locale) ? `${currency} ${figure}` : `${figure} ${currency}`);
        }
    });
});

describe('ordering the debtor list', () => {
    // Balances as the server derived them; the sort compares, never sums.
    const rows = [
        { name: 'Salma Adel', balance: 55_000, oldestUnpaidAt: '2026-08-08T15:10:00.000Z' },
        { name: 'Ahmed Zaki', balance: 1_200_000, oldestUnpaidAt: '2026-07-28T09:15:00.000Z' },
        { name: 'Nour El-Din Fathy', balance: 165_000, oldestUnpaidAt: '2026-01-14T16:45:00.000Z' },
    ];

    it('leads with the largest balance by default', () => {
        expect(sortDebtors(rows, 'balance').map((row) => row.name)).toEqual([
            'Ahmed Zaki',
            'Nour El-Din Fathy',
            'Salma Adel',
        ]);
    });

    it('leads with the longest-owed on "oldest", which is not the same order', () => {
        expect(sortDebtors(rows, 'oldest').map((row) => row.name)).toEqual([
            'Nour El-Din Fathy',
            'Ahmed Zaki',
            'Salma Adel',
        ]);
    });

    it('sorts by name without tripping over the hyphen', () => {
        expect(sortDebtors(rows, 'name').map((row) => row.name)).toEqual([
            'Ahmed Zaki',
            'Nour El-Din Fathy',
            'Salma Adel',
        ]);
    });

    it('does not reorder the callers array — the query owns it', () => {
        const original = [...rows];
        sortDebtors(rows, 'oldest');
        expect(rows).toEqual(original);
    });

    it('every mode is labelled, so the control can never render undefined', () => {
        for (const sort of DEBTOR_SORTS) {
            expect(DEBTOR_SORT_LABEL[sort]).toBeTruthy();
        }
    });
});

describe('the period labels read as the tail of both sentences', () => {
    it('names the takings card and the hero caption from one label', () => {
        expect(takingsLabel('This month')).toBe('Total collected this month');
        expect(takingsLabel('Today')).toBe('Total collected today');
        expect(takingsLabel('All time')).toBe('Total collected all time');

        expect(dueLabel('This month')).toBe('Due this month');
        expect(dueLabel('Today')).toBe('Due today');
    });

    it('heads the stats with the month being read, not the period selected', () => {
        expect(statsPeriodLabel(Date.parse('2026-06-15T10:00:00.000Z'))).toBe('Stats · June 2026');
    });
});

describe('a period that owes nothing', () => {
    // The hero draws a caption, an amount and a patient count. When the period
    // is square there is no amount to draw, and a zero under "Due this month"
    // beside "0 patients" reads as a broken figure rather than a settled one.
    const settled = (difference: number) =>
        amountStillDue(difference) === 0 && collectedAhead(difference) === 0;

    it('is settled when everything charged was collected', () => {
        expect(settled(0)).toBe(true);
    });

    it('is settled when nothing was charged at all — every day before the first visit', () => {
        expect(collectionRate(0, 0)).toBe(1);
        expect(settled(0)).toBe(true);
    });

    it('is not settled while anything is owed, or anything came in early', () => {
        expect(settled(2_382_000)).toBe(false);
        expect(settled(-120_000)).toBe(false);
    });
});
