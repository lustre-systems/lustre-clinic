// Every patient, and the search over them — `patients-list.html`, followed
// structurally: the heading with the size of the register beside it and the one
// way to add to it opposite, the search, then RECENT and the rows.
//
// Layout notes that are the design's and not defaults: the list is full-bleed
// with a hairline above every row, not cards — the register runs edge to edge,
// and a white rounded block per row stripes it and turns each patient into an
// object of their own. The RECENT label carries no count; the count is beside
// the heading, where it is the whole register rather than the length of a page.
//
// Arabic and Latin names are one list — rows set no face and `<Text>` picks the
// script per string (§6). Order is the server's (newest first); the A–Z grouping
// the design's own note describes is not drawn in it and is not invented here.
//
// The list opens on `patient.recent` and switches to `patient.search` once
// something is typed: `search` answers `[]` for an empty term by design, so
// browsing is its own procedure. Both are paged, and the next page loads as the
// end of the list nears. Balances are one query per loaded page, so a money
// failure costs only those rows' amounts. A refresh or a next page that failed
// leaves what is loaded up — stale, not gone (§7.14). The search is debounced
// because it runs over Tailscale; stale answers are dropped by the query key.
import { seesPayments } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: two of them, both external — the imperative `scrollToOffset` on the FlatList ref when the tab is re-tapped, and the search debounce's `setTimeout`
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { PatientRow } from '../../components/domain';
import {
    Banner,
    Button,
    EmptyState,
    SearchField,
    SectionLabel,
    SkeletonRows,
    Toast,
    useKeyboardHeight,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { useRole } from '../../shell/useRole';
import { color, radius, size, space, Text } from '../../theme';
import { PatientsIcon, PlusIcon, RetryIcon, SearchIcon } from './components/icons';
import { PAGE_SIZE, patientsApi } from './data/api';
import { errorText } from './data/errors';
import { usePagedQuery, useQueryEach } from './data/hooks';
import type { Patient } from './data/types';
import { type PatientPrefill, prefillOf } from './patientForm';

export type PatientListScreenProps = {
    onOpen: (patientId: string) => void;
    /**
     * Registering someone from here — `PatientEditScreen`, which the cluster
     * above routes to. Still optional so the screen can be mounted on its own
     * (a gallery, a test); without a handler the button says where the flow
     * lives rather than going missing, which is the rule the record's openers
     * already follow.
     *
     * `prefill` is a search that found nobody, offered as the patient to
     * register — the heading's button passes nothing.
     */
    onNewPatient?: (prefill?: PatientPrefill) => void;
    /**
     * Bumped when the Patients tab is tapped while this screen is already up.
     * The stack is already home, so what is left is the search field, which is
     * at the top of a register that can be several screens long. The term
     * itself is kept — it is what the desk typed, not a route.
     */
    goHome?: number;
};

const DEBOUNCE_MS = 250;

export function PatientListScreen({ onNewPatient, onOpen, goHome = 0 }: PatientListScreenProps) {
    const t = useT();
    const keyboard = useKeyboardHeight();
    const [term, setTerm] = useState('');
    const [toast, setToast] = useState<string | null>(null);
    const query = useDebounced(term, DEBOUNCE_MS);
    const searching = query.trim().length > 0;

    // Two queries rather than one keyed by the term: leaving the recent page
    // mounted means clearing the search puts it straight back without a round
    // trip, and the register's size stays on the heading while typing.
    //
    // Idle, the search resolves to `undefined` rather than `[]` — `[]` is an
    // answer, and the first keystroke would spend the round trip showing "No
    // patients found" instead of the skeleton.
    const recent = usePagedQuery(
        ['recent'],
        (offset) => patientsApi.recent(offset),
        (page, offset) =>
            page.patients.length === PAGE_SIZE && offset + PAGE_SIZE < page.total
                ? offset + PAGE_SIZE
                : undefined,
    );
    const results = usePagedQuery(
        ['search', query],
        (offset) => patientsApi.search(query, offset),
        (page, offset) => (page.length === PAGE_SIZE ? offset + PAGE_SIZE : undefined),
        { enabled: searching },
    );

    const list = searching ? results : recent;
    const pages = searching ? results.pages : recent.pages?.map((page) => page.patients);
    const rows = distinct(pages?.flat() ?? []);

    // A doctor's phone is refused balances by the server, so it does not ask.
    const { granted } = useRole();
    const pageIds = (pages ?? [])
        .map((page) => page.map((patient) => patient.id))
        .filter((ids) => ids.length > 0);
    const balances = useQueryEach(
        pageIds.map((ids) => ({ key: ['outstanding', ids], run: () => patientsApi.outstanding(ids) })),
        { enabled: seesPayments(granted) },
    );

    // A page whose rows shifted is a new query with no answer yet, so each row
    // keeps the balance last read for it rather than blinking to nothing owed.
    const lastDue = useRef(new Map<string, number>());
    balances.forEach((page, index) => {
        if (!page.data) return;
        for (const id of pageIds[index] ?? []) lastDue.current.set(id, 0);
        for (const row of page.data) lastDue.current.set(row.patientId, row.balance);
    });
    const dueByPatient = seesPayments(granted) ? new Map(lastDue.current) : new Map<string, number>();

    // The list on screen and its balances, and no further than that: the record
    // behind a row is read when it is opened, and the other tabs are refreshed by
    // their own pull. A refresh while searching re-runs the search, not the whole
    // list — the term is the query key.
    const pull = usePullToRefresh(
        () => {
            list.refetch();
            if (seesPayments(granted)) for (const page of balances) page.refetch();
        },
        list.loading || balances.some((page) => page.loading),
    );

    // An effect because scrolling is imperative and there is nothing to derive:
    // the signal is a number that says a tap happened, and the answer is a call
    // on the view. It is skipped on mount — a list that has just been mounted is
    // already at the top, and animating there would be a jolt for nothing.
    const scroller = useRef<FlatList<Patient>>(null);
    const shown = useRef(goHome);
    useEffect(() => {
        if (shown.current === goHome) return;
        shown.current = goHome;
        scroller.current?.scrollToOffset({ offset: 0, animated: true });
    }, [goHome]);

    // `keyboardShouldPersistTaps="handled"` below is what lets a result be
    // tapped in one go while typing: the tap reaches the row instead of being
    // spent closing the keyboard. The other half of that bargain is this. With
    // the tap handled, nothing dismisses the keyboard for us, and the list
    // stays mounted under the record, so the caret stayed in the search field
    // and the keys were drawn over the record that had just opened — its
    // contact row, its balance, its actions. `ui/Button` makes the same call on
    // every press, for the same reason; a row is not a `Button`.
    //
    // Every row, not only a search result: with the keyboard already down this
    // is nothing, and the rule "opening a patient ends the typing that found
    // them" is easier to keep than one that asks which list the row came from.
    function openPatient(patientId: string) {
        Keyboard.dismiss();
        onOpen(patientId);
    }

    const register = onNewPatient ?? (() => setToast('Registering a patient is not wired up here yet.'));

    // The term the empty answer was for — `query`, not `term`, so the button
    // never names something typed since that has not been searched yet.
    const unmatched = searching ? query.trim() : '';

    return (
        <View style={styles.screen}>
            {/* The search field is at the top of this list, so it is never
                under the keyboard — but the results it is filtering are. The
                window does not shrink around the keys (`ui/useKeyboardHeight`),
                so without the padding the last few matches cannot be scrolled
                clear of them: the content simply ends behind the keyboard. */}
            <FlatList
                ref={scroller}
                data={rows}
                keyExtractor={(patient) => patient.id}
                extraData={dueByPatient}
                renderItem={({ item }) => (
                    <PatientRow
                        patient={item}
                        balance={dueByPatient.get(item.id) ?? 0}
                        onPress={() => openPatient(item.id)}
                    />
                )}
                onEndReached={() => {
                    if (!list.moreError) list.loadMore();
                }}
                onEndReachedThreshold={2}
                contentContainerStyle={{ paddingBottom: space[12] + keyboard }}
                keyboardShouldPersistTaps="handled"
                refreshControl={pull.refreshControl}
                {...pull.scrollProps}
                ListHeaderComponent={
                    <>
                        <ListHeader total={recent.pages?.[0]?.total} onNewPatient={() => register()} />

                        <View style={styles.search}>
                            <SearchField
                                value={term}
                                onChangeText={setTerm}
                                onClear={() => setTerm('')}
                                placeholder="Name or phone number"
                                leading={<SearchIcon size={17} stroke={color.muted} />}
                                autoCorrect={false}
                                returnKeyType="search"
                                testID="patient-search"
                            />
                        </View>

                        {list.error && pages && (
                            <View style={styles.inset}>
                                <Banner
                                    tone="warning"
                                    message="Could not refresh. Showing the last results."
                                />
                            </View>
                        )}

                        {rows.length > 0 && (
                            <SectionLabel>{t(searching ? 'RESULTS' : 'RECENT')}</SectionLabel>
                        )}
                    </>
                }
                ListEmptyComponent={
                    list.loading && !pages ? (
                        <SkeletonRows count={7} ruled />
                    ) : list.error && !pages ? (
                        <EmptyState
                            icon={<RetryIcon size={22} stroke={color.ink2} />}
                            title="Could not reach the clinic"
                            body={errorText(list.error)}
                            actionLabel="Try again"
                            onAction={list.refetch}
                            weight="panel"
                        />
                    ) : (
                        <NoPatients searching={searching} unmatched={unmatched} onRegister={register} />
                    )
                }
                ListFooterComponent={
                    <MoreFooter error={list.moreError} loading={list.loadingMore} onRetry={list.loadMore} />
                }
            />

            <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
        </View>
    );
}

/**
 * An empty answer. A search that found nobody offers them as the patient to
 * register; the empty register and the error state have nothing typed to carry over.
 */
function NoPatients({
    searching,
    unmatched,
    onRegister,
}: {
    searching: boolean;
    unmatched: string;
    onRegister: (prefill?: PatientPrefill) => void;
}) {
    const t = useT();
    const prefill = prefillOf(unmatched);
    return (
        <EmptyState
            icon={
                prefill ? (
                    <PlusIcon size={22} stroke={color.ink2} />
                ) : searching ? (
                    <SearchIcon size={22} stroke={color.ink2} />
                ) : (
                    <PatientsIcon size={22} stroke={color.ink2} />
                )
            }
            title={t(searching ? 'No patients found' : 'No patients yet')}
            body={
                searching
                    ? t('Nothing matches that name or number.')
                    : t('Patients appear here as they are registered.')
            }
            actionLabel={prefill ? t('Add “{term}” as a new patient', { term: unmatched }) : undefined}
            onAction={prefill ? () => onRegister(prefill) : undefined}
            weight="panel"
        />
    );
}

function MoreFooter({ error, loading, onRetry }: { error?: Error; loading: boolean; onRetry: () => void }) {
    const t = useT();
    if (error) {
        return (
            <Banner
                tone="warning"
                message="Could not load more patients."
                action={<Button label="Try again" variant="text" size="md" onPress={onRetry} />}
            />
        );
    }
    return loading ? (
        <View style={styles.more}>
            <ActivityIndicator
                size="small"
                color={color.ink}
                accessibilityLabel={t('Loading more patients')}
            />
        </View>
    ) : null;
}

/** A registration between two page reads shifts every offset by one, which repeats a row at the seam. */
function distinct(patients: Patient[]): Patient[] {
    const seen = new Set<string>();
    return patients.filter((patient) => !seen.has(patient.id) && seen.add(patient.id));
}

/**
 * The design's heading: the word, the size of the register on its baseline, and
 * `New patient` opposite. The count is the clinic's total, not the rows loaded so
 * far. It is absent until the number is known rather than animating up from zero.
 */
function ListHeader({ total, onNewPatient }: { total?: number; onNewPatient: () => void }) {
    const t = useT();
    return (
        <View style={styles.header}>
            <View style={styles.titles}>
                <Text variant="title" accessibilityRole="header">
                    {t('Patients')}
                </Text>
                {total === undefined ? null : (
                    <Text variant="footnote" weight="medium" tone="muted" script="mono">
                        {grouped(total)}
                    </Text>
                )}
            </View>

            <NewPatientButton onPress={onNewPatient} />
        </View>
    );
}

/**
 * A filled `ink` pill, not `ui/AddButton` — that one is a dashed accent affordance
 * for the end of a list, and this is the screen's one solid action, drawn small
 * and dark opposite the heading. `ui/Button` is 44px at its shortest, which is
 * the height of something you commit to rather than a control riding on a
 * heading's baseline.
 */
function NewPatientButton({ onPress }: { onPress: () => void }) {
    const t = useT();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('New patient')}
            onPress={onPress}
            hitSlop={8}
            style={({ pressed }) => [styles.newPatient, pressed && styles.pressed]}
            testID="new-patient"
        >
            <PlusIcon size={15} stroke={color.inverse} />
            <Text variant="subhead" weight="semibold" tone="inverse">
                {t('New patient')}
            </Text>
        </Pressable>
    );
}

/** `1284` → `1,284`. Written out rather than left to `Intl`, which Hermes ships cut-down. */
function grouped(value: number): string {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function useDebounced(value: string, ms: number): string {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);

    return settled;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        paddingHorizontal: size.gutter,
        paddingTop: space[2],
        paddingBottom: space[2.5],
    },
    titles: { flexDirection: 'row', alignItems: 'baseline', gap: space[2.5] },
    newPatient: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        paddingHorizontal: space[3.5],
        paddingVertical: space[2.5],
        borderRadius: radius.full,
        backgroundColor: color.ink,
    },
    pressed: { opacity: 0.72 },

    search: { paddingHorizontal: size.gutter, paddingBottom: space[3] },
    inset: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    more: { alignItems: 'center', paddingVertical: space[5] },
});
