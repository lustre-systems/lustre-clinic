import { describe, expect, it } from 'bun:test';
import { matchDebtors } from './debtors';

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
