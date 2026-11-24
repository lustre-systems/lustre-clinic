type SearchableDebtor = { name: string; phone: string };

export function matchDebtors<T extends SearchableDebtor>(rows: readonly T[], term: string): readonly T[] {
    const needle = term.trim().toLowerCase();
    if (!needle) return rows;
    const digits = needle.replace(/\s/g, '');
    return rows.filter(
        (row) => row.name.toLowerCase().includes(needle) || row.phone.replace(/\s/g, '').includes(digits),
    );
}
