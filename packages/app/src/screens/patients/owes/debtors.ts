// The "Who owes" list's search, in a module with no React Native import so it
// is testable under `bun test`. Balances and their order are the server's
// (`balance.outstanding`); nothing here adds one up.

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
