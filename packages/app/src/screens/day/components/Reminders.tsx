import { FontAwesome } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
    Banner,
    Button,
    EmptyState,
    type PullToRefresh,
    RefreshView,
    usePendingAction,
} from '../../../components/ui';
import { useLocale, useT } from '../../../i18n';
import { forgetAlarmDismissal, useRearmReminderNudges, useRemindersOffToday } from '../../../notifications';
import { border, color, size, space, Text } from '../../../theme';
import { openWhatsApp } from '../../../whatsapp';
import { api, type PendingReminder, type QueryResult } from '../data';
import { describeError } from '../errors';
import { dateKey, relativeDayLabel, time12, todayKey } from '../time';
import { DaySkeleton } from './DayStates';
import { CheckIcon, CloseIcon, LabIcon, RetryIcon } from './icons';

export type RemindersProps = {
    query: QueryResult<PendingReminder[]>;
    pull?: PullToRefresh;
    onOpenRecord?: (patientId: string) => void;
};

export function Reminders({ query, pull, onOpenRecord }: RemindersProps) {
    const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
    const [failed, setFailed] = useState<{ name: string; what: 'reminder' | 'lab' } | null>(null);
    const [labBack, setLabBack] = useState<ReadonlySet<string>>(new Set());
    const t = useT();

    const rearm = useRearmReminderNudges();

    const pending = (query.data ?? []).filter((row) => !settled.has(row.id));

    const landed = [...labBack].filter(
        (id) => query.data?.find((row) => row.id === id)?.labStatus !== 'pending',
    );
    if (landed.length > 0) {
        setLabBack((current) => new Set([...current].filter((id) => !landed.includes(id))));
    }

    function forget(id: string) {
        setSettled((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
        });
    }

    async function settle(reminder: PendingReminder, how: 'sent' | 'skipped') {
        setSettled((current) => new Set(current).add(reminder.id));
        setFailed(null);

        try {
            if (how === 'sent') {
                await api.markReminderSent(reminder.id);
            } else {
                await api.markReminderSkipped(reminder.id);
            }
            rearm();
        } catch {
            forget(reminder.id);
            setFailed({ name: reminder.patient.name, what: 'reminder' });
        }
    }

    async function markLabBack(reminder: PendingReminder) {
        setLabBack((current) => new Set(current).add(reminder.id));
        setFailed(null);

        try {
            await api.markLabReady(reminder.appointmentId);
        } catch {
            setLabBack((current) => {
                const next = new Set(current);
                next.delete(reminder.id);
                return next;
            });
            setFailed({ name: reminder.patient.name, what: 'lab' });
        }
    }

    async function open(reminder: PendingReminder) {
        await openWhatsApp(reminder.whatsAppUrl, reminder.whatsappApp).then(
            () => settle(reminder, 'sent'),
            () => setFailed({ name: reminder.patient.name, what: 'reminder' }),
        );
    }

    if (query.status === 'loading') return <DaySkeleton />;

    if (query.status === 'error' && query.error && pending.length === 0) {
        const described = describeError(query.error);
        return (
            <RefreshView pull={pull}>
                <EmptyState
                    icon={<RetryIcon size={22} stroke={color.ink2} />}
                    title={described.title}
                    body={described.body}
                    actionLabel="Try again"
                    onAction={query.refetch}
                />
            </RefreshView>
        );
    }

    if (pending.length === 0) {
        return (
            <RefreshView pull={pull}>
                <EmptyState
                    icon={<CheckIcon size={22} stroke={color.ink2} />}
                    title="Everyone has been messaged"
                    body="No reminder is waiting to go out."
                />
            </RefreshView>
        );
    }

    return (
        <View style={styles.pane}>
            <TodayNudge />
            {failed ? (
                <Banner
                    tone="warning"
                    message={
                        failed.what === 'lab'
                            ? t("{name}'s lab work could not be marked — try again.", { name: failed.name })
                            : t("{name}'s reminder could not be marked — try again.", { name: failed.name })
                    }
                />
            ) : null}

            <ScrollView
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                refreshControl={pull?.refreshControl}
                {...pull?.scrollProps}
            >
                {pending.map((reminder) => (
                    <ReminderRow
                        key={reminder.id}
                        reminder={reminder}
                        labPending={reminder.labStatus === 'pending' && !labBack.has(reminder.id)}
                        onLabBack={() => void markLabBack(reminder)}
                        onSend={() => void open(reminder)}
                        onSkip={() => void settle(reminder, 'skipped')}
                        onOpenRecord={onOpenRecord && (() => onOpenRecord(reminder.patient.id))}
                    />
                ))}
            </ScrollView>
        </View>
    );
}

function TodayNudge() {
    const off = useRemindersOffToday();
    const rearm = useRearmReminderNudges();
    const [shown, setShown] = useState<boolean | null>(null);
    const [failed, setFailed] = useState(false);

    if (shown !== null && shown === off) setShown(null);

    const toggle = usePendingAction(async () => {
        setFailed(false);
        const today = todayKey();
        try {
            if (off) {
                forgetAlarmDismissal();
                await api.resumeRemindersToday(today);
            } else {
                await api.dismissRemindersToday(today);
            }
            setShown(!off);
        } catch {
            setFailed(true);
        } finally {
            rearm();
        }
    });

    const quiet = shown ?? off;
    return (
        <Banner
            tone={failed ? 'warning' : 'info'}
            message={
                failed
                    ? 'The reminder alarm could not be changed — try again.'
                    : quiet
                      ? 'The reminder alarm is off for today.'
                      : 'The reminder alarm repeats until the list is clear.'
            }
            action={
                <Button
                    label={quiet ? 'Turn back on' : 'Done for today'}
                    variant="text"
                    size="md"
                    loading={toggle.pending}
                    onPress={toggle.run}
                />
            }
        />
    );
}

function ReminderRow({
    reminder,
    labPending,
    onLabBack,
    onSend,
    onSkip,
    onOpenRecord,
}: {
    reminder: PendingReminder;
    labPending: boolean;
    onLabBack: () => void;
    onSend: () => void;
    onSkip: () => void;
    onOpenRecord?: (() => void) | undefined;
}) {
    const t = useT();
    const { time, meridiem } = time12(reminder.startsAt, useLocale());
    const day = relativeDayLabel(dateKey(reminder.startsAt));
    const when = `${day} · ${time} ${meridiem}`;

    const who = (
        <>
            <Text variant="headline" weight="semibold" numberOfLines={1}>
                {reminder.patient.name}
            </Text>
            <Text variant="subhead" tone="muted" numberOfLines={1}>
                {when}
            </Text>
            {labPending ? (
                <View style={styles.lab}>
                    <LabIcon size={13} stroke={color.due} />
                    <Text variant="subhead" weight="semibold" tone="due" numberOfLines={1}>
                        {t('Lab not back yet')}
                    </Text>
                </View>
            ) : null}
        </>
    );

    const whatsapp = <FontAwesome name="whatsapp" size={15} color={labPending ? color.ink : color.inverse} />;

    return (
        <View style={styles.item}>
            <View style={styles.row}>
                {onOpenRecord ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={[
                            reminder.patient.name,
                            when,
                            ...(labPending ? [t('Lab not back yet')] : []),
                        ].join(', ')}
                        accessibilityHint={t("Opens the patient's record")}
                        accessibilityActions={[
                            ...(labPending
                                ? [{ name: 'labBack', label: t('Mark the lab work as back') }]
                                : []),
                            { name: 'send', label: t('Send the reminder on WhatsApp') },
                            { name: 'skip', label: t('Skip this reminder') },
                        ]}
                        onAccessibilityAction={(event) => {
                            const action = event.nativeEvent.actionName;
                            if (action === 'labBack') onLabBack();
                            else if (action === 'send') onSend();
                            else onSkip();
                        }}
                        onPress={onOpenRecord}
                        hitSlop={space[1]}
                        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
                    >
                        {who}
                    </Pressable>
                ) : (
                    <View style={styles.body}>{who}</View>
                )}

                <View style={styles.controls}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("Skip {name}'s reminder", { name: reminder.patient.name })}
                        onPress={onSkip}
                        hitSlop={space[2]}
                        style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
                    >
                        <CloseIcon size={16} />
                    </Pressable>

                    {labPending ? null : (
                        <Button
                            label="WhatsApp"
                            variant="whatsapp"
                            size="md"
                            icon={whatsapp}
                            style={styles.send}
                            onPress={onSend}
                        />
                    )}
                </View>
            </View>
            {labPending ? (
                <View style={styles.labActions}>
                    <Button
                        label="Send anyway"
                        variant="secondary"
                        size="md"
                        icon={whatsapp}
                        style={styles.labAction}
                        onPress={onSend}
                    />
                    <Button
                        label="Lab's back"
                        size="md"
                        icon={<LabIcon size={15} stroke={color.inverse} />}
                        style={styles.labAction}
                        onPress={onLabBack}
                    />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    pane: { flex: 1 },
    list: { paddingHorizontal: size.gutter, paddingBottom: size.nav },
    item: {
        justifyContent: 'center',
        gap: space[3],
        paddingVertical: space[3.5],
        minHeight: size.row,
        borderBottomWidth: border.hair,
        borderBottomColor: color.line,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    lab: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    labActions: { flexDirection: 'row', gap: space[2] },
    labAction: { flex: 1 },
    body: { flex: 1, gap: space[0.5] },
    controls: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    skip: { padding: space[1] },
    pressed: { opacity: 0.5 },
    send: { paddingHorizontal: space[3.5] },
});
