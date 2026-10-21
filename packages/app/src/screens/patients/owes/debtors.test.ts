import { describe, expect, it } from 'bun:test';
import { DEBTOR_SORT_LABEL, DEBTOR_SORTS, matchDebtors, outstandingAge, sortDebtors } from './debtors';

describe('outstanding age', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');

    it('counts whole days, then coarsens', () => {
        expect(outstandingAge('2026-08-09T09:00:00.000Z', now)).toBe('today');
        expect(outstandingAge('2026-08-08T09:00:00.000Z', now)).toBe('1 day');
        expect(outstandingAge('2026-07-28T09:00:00.000Z', now)).toBe('12 days');
        expect(outstandingAge('2026-05-02T09:00:00.000Z', now)).toBe('3 months');
        expect(outstandingAge('2025-01-14T09:00:00.000Z', now)).toBe('1 year');
        // Twelve months by `/ 30`, short of a year by `/ 365`.
        expect(outstandingAge('2025-08-14T12:00:00.000Z', now)).toBe('1 year');
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

describe('searching the debtor list', () => {
    const rows = [
        { name: 'Salma Adel', phone: '+20 100 555 0101' },
        { name: 'Ahmed Zaki', phone: '+20 122 555 0199' },
    ];

    it('matches a name in any case, and a phone however it is spaced', () => {
        expect(matchDebtors(rows, 'salma').map((row) => row.name)).toEqual(['Salma Adel']);
        expect(matchDebtors(rows, '5550199').map((row) => row.name)).toEqual(['Ahmed Zaki']);
        expect(matchDebtors(rows, '555 0199').map((row) => row.name)).toEqual(['Ahmed Zaki']);
    });

    it('gives the whole list back for an empty search', () => {
        expect(matchDebtors(rows, '  ')).toHaveLength(2);
    });
});
