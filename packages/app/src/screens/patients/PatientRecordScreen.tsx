import type { CopyVars } from '@lustre/shared';
import { type ReactNode, type RefObject, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MoneyValue } from '../../components/domain';
import {
    Banner,
    Button,
    Callout,
    Chevron,
    ConfirmSheet,
    EmptyState,
    PopoverMenu,
    RefreshView,
    SegmentedControl,
    SkeletonRows,
    Toast,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { border, color, radius, size, space, Text } from '../../theme';
import { dateKey, formatMonth, todayKey } from '../day/time';
import { CustomAnswerRow } from './components/CustomAnswerRow';
import { HistoryRow } from './components/HistoryRow';
import {
    BookIcon,
    DeleteIcon,
    EditIcon,
    MoreIcon,
    OldVisitIcon,
    PayIcon,
    RetryIcon,
} from './components/icons';
import { paymentReceipt } from './components/money';
import { PatientHeader } from './components/PatientHeader';
import { RecordPaymentSheet } from './components/RecordPaymentSheet';
import { chairToday, patientsApi } from './data/api';
import { errorText } from './data/errors';
import { useMutation, useQuery } from './data/hooks';
import type {
    Answers,
    CustomQuestion,
    Patient,
    PatientHistoryEntry,
    QuestionnaireGap,
    SettleInput,
} from './data/types';

export type PatientRecordScreenProps = {
    patientId: string;
    onBack: () => void;
    backLabel?: string;
    onEdit?: () => void;
    onBook: (patient: Patient) => void;
    onOpenVisit?: (entry: PatientHistoryEntry) => void;
    onOldVisit?: () => void;
    notice?: { seq: number; message: string };
};

type Tab = 'visits' | 'details';

export function PatientRecordScreen({
    patientId,
    onBack,
    backLabel = 'Patients',
    onEdit,
    onBook,
    onOpenVisit,
    onOldVisit,
    notice,
}: PatientRecordScreenProps) {
    const t = useT();
    const [tab, setTab] = useState<Tab>('visits');
    const [toast, setToast] = useState<string | null>(null);
    const [payingOpen, setPayingOpen] = useState(false);
    const [seenNotice, setSeenNotice] = useState(notice?.seq);
    if (notice && notice.seq !== seenNotice) {
        setSeenNotice(notice.seq);
        setToast(notice.message);
    }
    const [menuOpen, setMenuOpen] = useState(false);
    const more = useRef<View>(null);
    const [menuTop, setMenuTop] = useState<number>(space[12]);

    function openMenu() {
        more.current?.measureInWindow((_x, y, _w, h) => {
            setMenuTop(y + h + space[1]);
            setMenuOpen(true);
        });
    }
    const [deleting, setDeleting] = useState(false);
    const [gone, setGone] = useState(false);

    const record = useQuery(['byId', patientId], () => patientsApi.byId(patientId));
    const questions = useQuery(['questions'], () => patientsApi.listQuestions());
    const settle = useMutation(patientsApi.settle);
    const remove = useMutation(patientsApi.delete);

    const patient = record.data?.patient;
    const history = record.data?.history ?? [];

    const today = todayKey();
    const arrived = history.find(
        (entry) => entry.status === 'checked_in' && dateKey(entry.startsAt) === today,
    );
    const chair = useQuery(
        ['chair', today, arrived?.appointmentId ?? 'none'],
        () => (arrived ? chairToday(arrived.appointmentId) : Promise.resolve(null)),
        { enabled: arrived !== undefined },
    );

    const pull = usePullToRefresh(() => {
        record.refetch();
        questions.refetch();
        if (arrived) chair.refetch();
    }, record.loading || questions.loading);

    const edit = onEdit ?? (() => setToast('Editing a patient is not wired up from here yet.'));

    const outstanding = history.reduce((total, entry) => total + Math.max(entry.balance ?? 0, 0), 0);
    const visits = history.filter((entry) => entry.visitId !== null).length;

    async function recordPayment(input: SettleInput) {
        const report = await settle.mutate(input);
        if (!report) return;

        setPayingOpen(false);
        record.refetch();
        setToast(paymentReceipt(report));
    }

    async function deletePatient() {
        const done = await remove.mutate(patientId);
        if (done === undefined) return;
        setDeleting(false);
        setGone(true);
        onBack();
    }

    return (
        <View style={styles.screen}>
            <RecordBar onBack={onBack} backLabel={backLabel} onMore={openMenu} moreRef={more} />

            {record.error && record.data && !gone && (
                <Banner tone="warning" message="Could not refresh this record. Showing what was last read." />
            )}

            {gone || (record.loading && !record.data) ? (
                <SkeletonRows count={5} gutter={size.gutter} ruled />
            ) : record.error && !record.data ? (
                <RefreshView pull={pull}>
                    <EmptyState
                        icon={<RetryIcon size={22} stroke={color.ink2} />}
                        title="Could not open this record"
                        body={errorText(record.error)}
                        actionLabel="Try again"
                        onAction={record.refetch}
                        weight="panel"
                    />
                </RefreshView>
            ) : record.data && patient ? (
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={pull.refreshControl}
                    {...pull.scrollProps}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.top}>
                        <PatientHeader patient={patient} onFailed={setToast} />

                        <Openers
                            patient={patient}
                            onBook={onBook}
                            onOldVisit={
                                onOldVisit ?? (() => setToast('Old visit is not wired up from here yet.'))
                            }
                        />

                        <Outstanding
                            amount={outstanding}
                            onRecordPayment={() => {
                                settle.reset();
                                setPayingOpen(true);
                            }}
                        />

                        <View style={styles.tabs}>
                            <SegmentedControl
                                segments={segments(visits, t)}
                                value={tab}
                                onChange={setTab}
                                size="sm"
                                accessibilityLabel="Record section"
                            />
                        </View>
                    </View>

                    {tab === 'visits' ? (
                        <History
                            history={history}
                            chairId={arrived ? chair.data : null}
                            onOpenVisit={onOpenVisit}
                        />
                    ) : (
                        <Details
                            notes={patient.notes}
                            answers={patient.custom}
                            gaps={record.data.questionnaireGaps}
                            questions={questions}
                            onEdit={edit}
                        />
                    )}
                </ScrollView>
            ) : null}

            {patient && outstanding > 0 ? (
                <RecordPaymentSheet
                    visible={payingOpen}
                    onClose={() => setPayingOpen(false)}
                    patientId={patient.id}
                    outstanding={outstanding}
                    isPending={settle.pending}
                    error={settle.error ? errorText(settle.error) : null}
                    onSubmit={(input) => void recordPayment(input)}
                />
            ) : null}

            <PopoverMenu
                visible={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchor={{ top: menuTop, end: size.gutter }}
                items={[
                    {
                        key: 'edit',
                        label: t('Edit patient'),
                        icon: <EditIcon size={16} stroke={color.ink2} />,
                        onPress: () => {
                            setMenuOpen(false);
                            edit();
                        },
                    },
                    {
                        key: 'delete',
                        label: t('Delete patient'),
                        icon: <DeleteIcon size={16} stroke={color.danger} />,
                        danger: true,
                        onPress: () => {
                            setMenuOpen(false);
                            remove.reset();
                            setDeleting(true);
                        },
                    },
                ]}
            />

            <ConfirmSheet
                visible={deleting}
                title="Delete this patient?"
                body="The record goes, with every booking and visit on it. A patient with a payment on file cannot be deleted. This cannot be undone."
                detail={
                    remove.error ? (
                        <Text variant="subhead" tone="due" style={styles.deleteError}>
                            {errorText(remove.error)}
                        </Text>
                    ) : null
                }
                confirmLabel="Delete patient"
                onConfirm={() => void deletePatient()}
                onCancel={() => setDeleting(false)}
                destructive
                loading={remove.pending}
                testID="record-delete-confirm"
            />

            <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
        </View>
    );
}

function RecordBar({
    onBack,
    backLabel,
    onMore,
    moreRef,
}: {
    onBack?: () => void;
    backLabel: string;
    onMore: () => void;
    moreRef: RefObject<View | null>;
}) {
    const t = useT();
    return (
        <View style={styles.bar}>
            {onBack ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Back to {where}', { where: t(backLabel) })}
                    onPress={onBack}
                    hitSlop={10}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                    <Chevron direction="back" size={9} tone="ink" />
                </Pressable>
            ) : (
                <View style={styles.iconButton} />
            )}

            <Text variant="eyebrow" tone="muted" style={styles.barEyebrow}>
                {t('PATIENT')}
            </Text>

            <Pressable
                ref={moreRef}
                accessibilityRole="button"
                accessibilityLabel={t('More')}
                onPress={onMore}
                hitSlop={10}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                testID="record-more"
            >
                <MoreIcon size={16} stroke={color.ink} />
            </Pressable>
        </View>
    );
}

function Openers({
    patient,
    onBook,
    onOldVisit,
}: {
    patient: Patient;
    onBook: (patient: Patient) => void;
    onOldVisit: () => void;
}) {
    return (
        <View style={styles.openers}>
            <Button
                label="Book appointment"
                size="md"
                icon={<BookIcon size={16} stroke={color.inverse} />}
                onPress={() => onBook(patient)}
                style={styles.opener}
            />
            <Button
                label="Old visit"
                variant="secondary"
                size="md"
                icon={<OldVisitIcon size={16} stroke={color.ink} />}
                onPress={onOldVisit}
                style={styles.opener}
                testID="patient-old-visit"
            />
        </View>
    );
}

function segments(visits: number, t: (copy: string) => string) {
    return [
        { value: 'visits' as const, label: visits > 0 ? `${t('Visits')} · ${visits}` : t('Visits') },
        { value: 'details' as const, label: t('Details') },
    ];
}

function Outstanding({ amount, onRecordPayment }: { amount: number; onRecordPayment: () => void }) {
    const t = useT();
    if (amount <= 0) return null;

    return (
        <View style={styles.strip}>
            <View style={styles.stripDot} />
            <Text variant="subhead" tone="muted" style={styles.stripLabel}>
                {t('Outstanding')}
            </Text>
            <MoneyValue piastres={amount} tone="due" variant="headline" weight="bold" showCurrency={false} />
            <Pill
                label="Record payment"
                icon={<PayIcon size={14} stroke={color.ink} />}
                onPress={onRecordPayment}
                testID="record-payment"
            />
        </View>
    );
}

function Pill({
    label,
    icon,
    onPress,
    testID,
}: {
    label: string;
    icon?: ReactNode;
    onPress: () => void;
    testID?: string;
}) {
    const t = useT();
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            hitSlop={8}
            style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
            testID={testID}
        >
            {icon}
            <Text variant="footnote" weight="bold">
                {t(label)}
            </Text>
        </Pressable>
    );
}

function History({
    history,
    chairId,
    onOpenVisit,
}: {
    history: PatientHistoryEntry[];
    chairId: string | null | undefined;
    onOpenVisit?: (entry: PatientHistoryEntry) => void;
}) {
    const t = useT();
    const years = useMemo(() => groupByYear(history), [history]);
    const paid = history.reduce((total, entry) => total + (entry.paidTotal ?? 0), 0);

    if (history.length === 0) {
        return (
            <EmptyState
                title="Nothing on file yet"
                body="Appointments and visits appear here as soon as this patient is booked in."
                weight="line"
            />
        );
    }

    return (
        <View>
            <View style={styles.summary}>
                <Text variant="footnote" tone="muted">
                    {sinceLabel(history, t)}
                </Text>
                {paid > 0 ? (
                    <View style={styles.summaryPaid}>
                        <MoneyValue piastres={paid} variant="footnote" tone="muted" showCurrency={false} />
                        <Text variant="footnote" tone="muted">
                            {t('paid')}
                        </Text>
                    </View>
                ) : null}
            </View>

            {years.map(([year, rows]) => (
                <View key={year}>
                    <View style={styles.band}>
                        <Text variant="eyebrow" tone="muted">
                            {year}
                        </Text>
                    </View>
                    {rows.map((entry) => (
                        <HistoryRow
                            key={entry.appointmentId}
                            entry={entry}
                            inChair={chairId === undefined ? undefined : entry.appointmentId === chairId}
                            onOpen={onOpenVisit}
                        />
                    ))}
                </View>
            ))}
        </View>
    );
}

function sinceLabel(history: PatientHistoryEntry[], t: (copy: string, vars?: CopyVars) => string): string {
    const oldest = history.at(-1);
    if (!oldest) return '';

    return t('Since {month}', { month: formatMonth(dateKey(oldest.startsAt)) });
}

function groupByYear(history: PatientHistoryEntry[]): Array<[string, PatientHistoryEntry[]]> {
    const groups = new Map<string, PatientHistoryEntry[]>();
    for (const entry of history) {
        const year = dateKey(entry.startsAt).slice(0, 4);
        const bucket = groups.get(year);
        if (bucket) bucket.push(entry);
        else groups.set(year, [entry]);
    }
    return [...groups].sort((a, b) => b[0].localeCompare(a[0]));
}

type DetailsProps = {
    notes: string | null;
    answers: Answers;
    gaps: QuestionnaireGap[];
    questions: { data: CustomQuestion[] | undefined; loading: boolean; error: Error | undefined };
    onEdit: () => void;
};

function Details({ notes, answers, gaps, questions, onEdit }: DetailsProps) {
    const t = useT();
    const gapByKey = useMemo(() => new Map(gaps.map((gap) => [gap.key, gap])), [gaps]);

    const hidden = useMemo(() => {
        if (!questions.data) return 0;
        const shown = new Set(questions.data.map((q) => q.key));
        return Object.keys(answers).filter((key) => !shown.has(key)).length;
    }, [answers, questions.data]);

    const unanswered = gaps.filter((gap) => gap.reason === 'unanswered').length;
    const stale = gaps.filter((gap) => gap.reason === 'answer_no_longer_valid').length;

    return (
        <View style={styles.details}>
            {notes ? (
                <>
                    <View style={styles.sectionHead}>
                        <Text variant="eyebrow" tone="muted">
                            {t('NOTES')}
                        </Text>
                    </View>
                    <View style={styles.notes}>
                        <Text variant="body" selectable testID="patient-notes">
                            {notes}
                        </Text>
                    </View>
                </>
            ) : null}

            <View style={styles.sectionHead}>
                <Text variant="eyebrow" tone="muted">
                    {questions.data
                        ? `${t('CLINIC QUESTIONS')} · ${questions.data.length}`
                        : t('CLINIC QUESTIONS')}
                </Text>
                {questions.data && questions.data.length > 0 ? (
                    <Pill label="Edit" onPress={onEdit} testID="answer" />
                ) : null}
            </View>

            {gaps.length > 0 && (
                <View style={styles.gap}>
                    <Callout tone="warning" title="Still to ask">
                        {[
                            unanswered > 0 ? t('{count} never asked', { count: unanswered }) : null,
                            stale > 0
                                ? t('{count} answered before the question changed', { count: stale })
                                : null,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </Callout>
                </View>
            )}

            {questions.loading && !questions.data ? (
                <SkeletonRows count={3} gutter={space[4]} ruled />
            ) : questions.error && !questions.data ? (
                <EmptyState
                    title="Could not load the clinic's questions"
                    body={errorText(questions.error)}
                    weight="line"
                />
            ) : questions.data && questions.data.length === 0 ? (
                <EmptyState
                    title="No questions set up"
                    body="Questions the clinic adds in settings appear here for every patient."
                    weight="line"
                />
            ) : (
                <View>
                    {(questions.data ?? []).map((question) => (
                        <View key={question.key} style={styles.answer}>
                            <CustomAnswerRow
                                question={question}
                                value={answers[question.key]}
                                gap={gapByKey.get(question.key)?.reason}
                            />
                        </View>
                    ))}
                </View>
            )}

            {hidden > 0 && (
                <View style={styles.gap}>
                    <Callout tone="note">
                        {hidden === 1
                            ? t(
                                  '1 answer is kept from questions the clinic no longer asks. It is hidden, not deleted, and comes back if the question is reactivated.',
                              )
                            : t(
                                  '{count} answers are kept from questions the clinic no longer asks. They are hidden, not deleted, and come back if the question is reactivated.',
                                  { count: hidden },
                              )}
                    </Callout>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    content: { paddingBottom: size.nav + space[6] },
    deleteError: { marginTop: space[3] },

    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingHorizontal: space[4],
        paddingTop: space[1.5],
        paddingBottom: space[0.5],
    },
    iconButton: {
        width: 34,
        height: 34,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.surface,
        borderWidth: border.hair,
        borderColor: color.line,
    },
    barEyebrow: { flex: 1 },
    pressed: { opacity: 0.6 },

    top: { paddingHorizontal: size.gutter, paddingTop: space[2] },
    openers: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
    opener: { flex: 1, minHeight: size.button },

    strip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        marginTop: space[3],
        paddingVertical: space[3],
        borderTopWidth: border.hair,
        borderBottomWidth: border.hair,
        borderColor: color.line,
    },
    stripDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: color.due },
    stripLabel: { flex: 1 },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[3],
        paddingVertical: space[1.5],
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.outline,
    },

    tabs: { marginTop: space[3] },

    summary: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[4],
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        paddingBottom: space[2.5],
        borderTopWidth: border.hair,
        borderTopColor: color.line,
    },
    summaryPaid: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },

    band: {
        paddingHorizontal: size.gutter,
        paddingVertical: space[1.5],
        backgroundColor: color.surface2,
        borderTopWidth: border.hair,
        borderBottomWidth: border.hair,
        borderColor: color.line,
    },

    details: { paddingTop: space[2] },
    sectionHead: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        paddingBottom: space[2],
    },
    notes: {
        paddingHorizontal: size.gutter,
        paddingBottom: space[3],
        borderBottomWidth: border.hair,
        borderBottomColor: color.line,
    },
    gap: { paddingHorizontal: size.gutter, paddingVertical: space[1] },
    answer: {
        paddingHorizontal: size.gutter,
        borderBottomWidth: border.hair,
        borderBottomColor: color.line,
    },
});
