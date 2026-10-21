// The "Owes money" filter's arithmetic-free parts, in a module with no React
// Native import so it is testable under `bun test`. Balances are the server's
// (`balance.outstanding`); nothing here adds one up, it only orders them and
// says how long the oldest has been owed.
import { localizeCopy } from '@lustre/shared';
import { serverNow } from '../../../api/serverClock';
import { getLocale } from '../../../i18n/runtime';

export const DEBTOR_SORTS = ['balance', 'oldest', 'name'] as const;

export type DebtorSort = (typeof DEBTOR_SORTS)[number];

export const DEBTOR_SORT_LABEL: Record<DebtorSort, string> = {
    balance: 'By balance',
    oldest: 'Oldest first',
    name: 'Name A–Z',
};

type SortableDebtor = { name: string; balance: number; oldestUnpaidAt: string };

// `oldest` compares the ISO stamps directly, which sort lexicographically, so
// the longest-owed row leads.
export function sortDebtors<T extends SortableDebtor>(rows: readonly T[], sort: DebtorSort): T[] {
    const ordered = [...rows];

    if (sort === 'oldest') return ordered.sort((a, b) => a.oldestUnpaidAt.localeCompare(b.oldestUnpaidAt));
    if (sort === 'name') return ordered.sort((a, b) => a.name.localeCompare(b.name));
    return ordered.sort((a, b) => b.balance - a.balance);
}

type SearchableDebtor = { name: string; phone: string };

/** Search inside the list, on the phone: the whole list is already here. */
export function matchDebtors<T extends SearchableDebtor>(rows: readonly T[], term: string): readonly T[] {
    const needle = term.trim().toLowerCase();
    if (!needle) return rows;
    const digits = needle.replace(/\s/g, '');
    return rows.filter(
        (row) => row.name.toLowerCase().includes(needle) || row.phone.replace(/\s/g, '').includes(digits),
    );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function outstandingAge(iso: string, now: Date = new Date(serverNow())): string {
    const locale = getLocale();
    const days = Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);

    if (days <= 0) return localizeCopy(locale, 'today');
    if (days === 1) return localizeCopy(locale, '1 day');
    if (days < 31) return localizeCopy(locale, '{count} days', { count: days });

    const months = Math.floor(days / 30);
    if (months < 12) {
        return months === 1
            ? localizeCopy(locale, '1 month')
            : localizeCopy(locale, '{count} months', { count: months });
    }

    const years = Math.floor(days / 365);
    return years === 1
        ? localizeCopy(locale, '1 year')
        : localizeCopy(locale, '{count} years', { count: years });
}
