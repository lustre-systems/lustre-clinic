/**
 * The reminders tab of `day-view-schedule.html` — SPEC §11. Nothing here sends
 * anything: WhatsApp Business cannot be driven from another app, so the button
 * opens a prefilled chat and the row then asks what happened. "Sent" is a claim
 * the user makes rather than a fact the app observes, and skipping is a
 * first-class action next to it. Rows are marked one at a time, optimistically,
 * and outside `useLocalMutation` (which holds one in-flight write and one error
 * for the whole component) — a failure puts the row back and says so. Rows are
 * marked sent on the way out, not the way back: nothing tells whether the
 * message was actually typed, and a row left pending gets sent twice by the
 * next person. The list spans days — a reminder falls due a lead time before
 * its appointment — so each row names its day.
 *
 * A row whose appointment waits on lab work that is not back says so, because
 * this is where the visit is confirmed with the patient. Its main action is
 * Lab's back, after which it is an ordinary reminder again. Sending is never
 * blocked — the lab often promises the work by phone — so WhatsApp stays, as
 * Send anyway. Lab's back is optimistic like the rest, and a failure puts the
 * warning back.
 *
 * Above the list, the daily nudge for today: it rings again every repeat until
 * the list is clear, and Done for today stops it for the rest of the day on both
 * desk phones, as the same button on the ringing alarm does. Turn back on undoes
 * it. Neither touches the list.
 */
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
    /** The day screen's pull-to-refresh, shared so the tab re-reads with it. */
    pull?: PullToRefresh;
    /**
     * Open the patient behind a row. The reminder carries the patient embedded,
     * so the id is already here and the name is a way into the record — which is
     * what the name is for: "who is this" is the question a reminder raises.
     */
    onOpenRecord?: (patientId: string) => void;
};

export function Reminders({ query, pull, onOpenRecord }: RemindersProps) {
    const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
    const [failed, setFailed] = useState<{ name: string; what: 'reminder' | 'lab' } | null>(null);
    const [labBack, setLabBack] = useState<ReadonlySet<string>>(new Set());
    const t = useT();

    // Every action here moves what the daily nudge should be armed against, and
    // they all go over the raw tRPC client, which leaves the query cache alone.
    const rearm = useRearmReminderNudges();

    const pending = (query.data ?? []).filter((row) => !settled.has(row.id));

    // An optimistic Lab's back has done its job once the list stops saying
    // `pending`. Kept past that, it would hide the warning if the lab were
    // switched back on. Cleared during render, as `BookingScreen` settles its day.
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

/**
 * Done for today, or Turn back on once it is. The answer is held on screen
 * until the settings read back agree, or the label would flick back for the
 * moment between the write and the refetch.
 */
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
                // This phone's own press would keep today quiet whatever the server says.
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

/**
 * The row reads as the patient, not as a strip of anonymous buttons. Opening
 * the record is the patient half's own press, so the name and the time are one
 * target carrying one label — "Sara Elmasry, Fri 21 Aug · 12:00 PM" — and Send
 * and Skip carry theirs. Three nodes, each of which says what it is and whose
 * it is, rather than a bare name followed by an unlabelled ✕.
 *
 * It is deliberately not one node with the other two as custom actions, which
 * is the obvious shape and does not survive Android: `accessible` on the
 * wrapper groups the subtree on iOS only, a `Pressable` puts itself back in the
 * tree underneath it (`accessible={false}` and `no-hide-descendants` both lose
 * that argument — checked with `uiautomator dump`, not assumed), and
 * `ui/Button` takes a closed prop list this cluster cannot widen. A grouping
 * the platform ignores is worse than none: it reads as a duplicate of the row
 * it wraps. The actions stay on the patient node instead, where TalkBack's
 * context menu reaches them, so nothing is only-reachable by hunting.
 *
 * `hitSlop` aside, the touch targets are unchanged, and the patient half is a
 * sibling of the controls rather than a parent, so it cannot swallow a press.
 */
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
    /** Skip and Send, grouped so one prop hides both from the screen reader. */
    controls: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    skip: { padding: space[1] },
    pressed: { opacity: 0.5 },
    send: { paddingHorizontal: space[3.5] },
});
