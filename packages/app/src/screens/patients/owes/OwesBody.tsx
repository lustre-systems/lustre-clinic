// The Patients list with "Owes money" on: who owes the clinic and how much,
// from `balance.outstanding`, in place of the recent rows and search results.
// It is the secretary's old "Who owe" list from the Money tab, moved rather than
// rewritten: the header with the total due, the rows with how long each has
// been owed, the sort, and the search field above filtering it on the phone.
//
// Not filtered by period — an amount owed is owed whatever the date. The total
// is the report's own and is hidden while searching rather than recomputed
// over the matches: a figure that shrank as you typed would read as the clinic
// being owed less than it is.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DropdownMenu, EmptyState, type MenuAnchor, SkeletonRows } from '../../../components/ui';
import { color, space } from '../../../theme';
import { errorMessage } from '../../stats/format';
import { RetryIcon, SearchIcon } from '../components/icons';
import { DebtorRow } from './DebtorRow';
import type { useOutstanding } from './data';
import { DEBTOR_SORT_LABEL, DEBTOR_SORTS, type DebtorSort, matchDebtors, sortDebtors } from './debtors';
import { OweHead } from './OweHead';

export type OwesBodyProps = {
    outstanding: ReturnType<typeof useOutstanding>;
    /** What is typed in the list's search field, unsettled: the filter is local, so there is no round trip to wait for. */
    term: string;
    onOpen: (patientId: string) => void;
};

export function OwesBody({ outstanding, term, onOpen }: OwesBodyProps) {
    const [sort, setSort] = useState<DebtorSort>('balance');
    const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

    const searching = term.trim() !== '';
    const report = outstanding.data;
    const rows = sortDebtors(matchDebtors(report?.patients ?? [], term), sort);

    return (
        <View testID="owes-list">
            <View style={styles.head}>
                <OweHead
                    total={searching ? null : (report?.total ?? null)}
                    sort={sort}
                    sortOpen={anchor !== null}
                    onOpenSort={setAnchor}
                />
            </View>

            {outstanding.error ? (
                <EmptyState
                    icon={<RetryIcon size={22} stroke={color.ink2} />}
                    title="Could not reach the clinic"
                    body={errorMessage(outstanding.error)}
                    actionLabel="Try again"
                    onAction={outstanding.refetch}
                    weight="panel"
                />
            ) : !report ? (
                <SkeletonRows count={5} ruled />
            ) : rows.length === 0 ? (
                // Two different facts: a search that matched nobody is not a
                // clinic that is owed nothing.
                searching ? (
                    <EmptyState
                        icon={<SearchIcon size={22} stroke={color.ink2} />}
                        title="No patients found"
                        body="Nobody who owes matches that name or number."
                        weight="panel"
                    />
                ) : (
                    <EmptyState title="Nobody owes anything." weight="panel" />
                )
            ) : (
                <View style={styles.rows}>
                    {rows.map((patient, index) => (
                        <DebtorRow
                            key={patient.patientId}
                            patient={patient}
                            index={index}
                            onPress={() => onOpen(patient.patientId)}
                        />
                    ))}
                </View>
            )}

            <DropdownMenu
                visible={anchor !== null}
                onClose={() => setAnchor(null)}
                options={DEBTOR_SORTS.map((value) => ({ value, label: DEBTOR_SORT_LABEL[value] }))}
                value={sort}
                onChange={setSort}
                anchor={anchor ?? undefined}
                accessibilityLabel="Sort patients"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    head: { paddingTop: space[1], paddingBottom: space[3] },
    rows: { borderTopWidth: 1, borderTopColor: color.hair },
});
