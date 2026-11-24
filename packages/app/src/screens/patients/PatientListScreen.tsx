import { seesPayments } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: two of them, both external — the imperative `scrollToOffset` on the FlatList ref when the tab is re-tapped, and the search debounce's `setTimeout`
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Keyboard,
    Pressable,
    type View as RNView,
    StyleSheet,
    View,
} from 'react-native';
import { PatientRow, type PatientSummary } from '../../components/domain';
import {
    Banner,
    Button,
    Chevron,
    DropdownMenu,
    EmptyState,
    FadeUp,
    type MenuAnchor,
    SearchField,
    SkeletonRows,
    Toast,
    useKeyboardHeight,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { useRole } from '../../shell/useRole';
import { color, radius, size, space, Text } from '../../theme';
import { MoneyValue } from '../stats/MoneyValue';
import { PatientsIcon, PlusIcon, RetryIcon, SearchIcon } from './components/icons';
import { PAGE_SIZE, patientsApi } from './data/api';
import { errorText } from './data/errors';
import { usePagedQuery, useQueryEach } from './data/hooks';
import type { Patient } from './data/types';
import { useOutstanding } from './owes/data';
import { matchDebtors } from './owes/debtors';
import { OwesEmpty } from './owes/OwesEmpty';
import { type PatientPrefill, prefillOf } from './patientForm';

export type PatientListScreenProps = {
    onOpen: (patientId: string) => void;
    onNewPatient?: (prefill?: PatientPrefill) => void;
    goHome?: number;
};

const DEBOUNCE_MS = 250;
const MODE_MENU_GAP = 8;

type ListMode = 'recent' | 'name' | 'owes';

const MODE_LABEL: Record<ListMode, string> = {
    recent: 'Recent',
    name: 'Alphabetical',
    owes: 'Who owes',
};

export function PatientListScreen({ onNewPatient, onOpen, goHome = 0 }: PatientListScreenProps) {
    const keyboard = useKeyboardHeight();
    const [term, setTerm] = useState('');
    const [toast, setToast] = useState<string | null>(null);
    const [mode, setMode] = useState<ListMode>('recent');
    const query = useDebounced(term, DEBOUNCE_MS);
    const searching = query.trim().length > 0;

    const { granted } = useRole();
    const owing = mode === 'owes' && seesPayments(granted);
    const modes: ListMode[] = seesPayments(granted) ? ['recent', 'name', 'owes'] : ['recent', 'name'];
    const order = mode === 'name' ? 'name' : 'newest';
    const outstanding = useOutstanding(owing);

    const recent = usePagedQuery(
        ['recent', order],
        (offset) => patientsApi.recent(offset, order),
        (page, offset) =>
            page.patients.length === PAGE_SIZE && offset + PAGE_SIZE < page.total
                ? offset + PAGE_SIZE
                : undefined,
    );
    const results = usePagedQuery(
        ['search', query],
        (offset) => patientsApi.search(query, offset),
        (page, offset) => (page.length === PAGE_SIZE ? offset + PAGE_SIZE : undefined),
        { enabled: searching && !owing },
    );

    const list = searching ? results : recent;
    const pages = searching ? results.pages : recent.pages?.map((page) => page.patients);
    const found = distinct(pages?.flat() ?? []);
    const rows =
        searching && order === 'name' ? [...found].sort((a, b) => a.name.localeCompare(b.name)) : found;

    const pageIds = (pages ?? [])
        .map((page) => page.map((patient) => patient.id))
        .filter((ids) => ids.length > 0);
    const balances = useQueryEach(
        pageIds.map((ids) => ({ key: ['outstanding', ids], run: () => patientsApi.outstanding(ids) })),
        { enabled: seesPayments(granted) },
    );

    const lastDue = useRef(new Map<string, number>());
    balances.forEach((page, index) => {
        if (!page.data) return;
        for (const id of pageIds[index] ?? []) lastDue.current.set(id, 0);
        for (const row of page.data) lastDue.current.set(row.patientId, row.balance);
    });
    const dueByPatient = seesPayments(granted) ? new Map(lastDue.current) : new Map<string, number>();

    const listed: Listed[] = owing
        ? matchDebtors(outstanding.data?.patients ?? [], term).map((row) => ({
              id: row.patientId,
              patient: { ...row, id: row.patientId },
              balance: row.balance,
          }))
        : rows.map((patient) => ({ id: patient.id, patient, balance: dueByPatient.get(patient.id) ?? 0 }));

    const view = owing ? 'owes' : order;
    const seen = useRef({ view, ids: new Set<string>() });
    if (seen.current.view !== view) seen.current = { view, ids: new Set() };

    const pull = usePullToRefresh(
        () => {
            if (owing) return outstanding.refetch();
            list.refetch();
            if (seesPayments(granted)) for (const page of balances) page.refetch();
        },
        owing ? outstanding.isLoading : list.loading || balances.some((page) => page.loading),
    );

    const scroller = useRef<FlatList<Listed>>(null);
    const shown = useRef(goHome);
    useEffect(() => {
        if (shown.current === goHome) return;
        shown.current = goHome;
        scroller.current?.scrollToOffset({ offset: 0, animated: true });
    }, [goHome]);

    function openPatient(patientId: string) {
        Keyboard.dismiss();
        onOpen(patientId);
    }

    const register = onNewPatient ?? (() => setToast('Registering a patient is not wired up here yet.'));

    const unmatched = searching ? query.trim() : '';

    return (
        <View style={styles.screen}>
            <FlatList
                ref={scroller}
                data={listed}
                keyExtractor={(row) => `${view}:${row.id}`}
                extraData={dueByPatient}
                renderItem={({ item, index }) => {
                    const fresh = !seen.current.ids.has(item.id);
                    seen.current.ids.add(item.id);
                    return (
                        <FadeUp index={index} animate={fresh}>
                            <PatientRow
                                patient={item.patient}
                                balance={item.balance}
                                onPress={() => openPatient(item.id)}
                            />
                        </FadeUp>
                    );
                }}
                onEndReached={() => {
                    if (!owing && !list.moreError) list.loadMore();
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

                        {!owing && list.error && pages && (
                            <View style={styles.inset}>
                                <Banner
                                    tone="warning"
                                    message="Could not refresh. Showing the last results."
                                />
                            </View>
                        )}

                        <ModeLabel
                            mode={owing ? 'owes' : mode === 'owes' ? 'recent' : mode}
                            modes={modes}
                            label={searching && !owing && mode !== 'name' ? 'RESULTS' : undefined}
                            owed={owing && !searching ? outstanding.data?.total : undefined}
                            onChange={setMode}
                        />
                    </>
                }
                ListEmptyComponent={
                    owing ? (
                        <OwesEmpty outstanding={outstanding} searching={term.trim() !== ''} />
                    ) : list.loading && !pages ? (
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
                    owing ? null : (
                        <MoreFooter
                            error={list.moreError}
                            loading={list.loadingMore}
                            onRetry={list.loadMore}
                        />
                    )
                }
            />

            <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
        </View>
    );
}

type Listed = { id: string; patient: PatientSummary; balance: number };

function ModeLabel({
    mode,
    modes,
    label,
    owed,
    onChange,
}: {
    mode: ListMode;
    modes: ListMode[];
    label?: string;
    owed?: number;
    onChange: (mode: ListMode) => void;
}) {
    const t = useT();
    const button = useRef<RNView>(null);
    const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

    function open() {
        button.current?.measureInWindow((_x, y, _width, height) =>
            setAnchor({ top: y + height + MODE_MENU_GAP, start: size.gutter }),
        );
    }

    return (
        <View style={styles.mode}>
            <Pressable
                ref={button}
                accessibilityRole="button"
                accessibilityLabel={`${t('Order patients')} — ${t(MODE_LABEL[mode])}`}
                accessibilityState={{ expanded: anchor !== null }}
                onPress={open}
                hitSlop={14}
                style={({ pressed }) => [styles.modeButton, pressed && styles.modePressed]}
                testID="patients-mode"
            >
                <Text variant="eyebrow" tone="muted">
                    {t(label ?? MODE_LABEL[mode])}
                </Text>
                <Chevron direction={anchor ? 'up' : 'down'} size={6} />
            </Pressable>

            {owed === undefined ? null : (
                <View style={styles.owed}>
                    <MoneyValue
                        amount={owed}
                        variant="footnote"
                        currencyVariant="footnote"
                        weight="bold"
                        tone="dueText"
                        compact
                        testID="owes-total"
                    />
                </View>
            )}

            <DropdownMenu
                visible={anchor !== null}
                onClose={() => setAnchor(null)}
                options={modes.map((value) => ({ value, label: MODE_LABEL[value] }))}
                value={mode}
                onChange={onChange}
                anchor={anchor ?? undefined}
                accessibilityLabel="Order patients"
            />
        </View>
    );
}

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

function distinct(patients: Patient[]): Patient[] {
    const seen = new Set<string>();
    return patients.filter((patient) => !seen.has(patient.id) && seen.add(patient.id));
}

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
    mode: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[2],
        minHeight: space[6],
        paddingHorizontal: size.gutter,
    },
    modeButton: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
    modePressed: { opacity: 0.6 },
    owed: {
        paddingVertical: space[0.5],
        paddingHorizontal: space[2.5],
        borderRadius: radius.full,
        backgroundColor: color.dueSoft,
    },
    inset: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    more: { alignItems: 'center', paddingVertical: space[5] },
});
