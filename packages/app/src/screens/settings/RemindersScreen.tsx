import { leadDaysOf, leadHoursOf, REMINDER_LEAD_MAX_DAYS, REMINDER_TOKENS } from '@lustre/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDemoMode, useTRPC } from '../../api';
import { formatClock12 } from '../../components/domain';
import {
    Button,
    Callout,
    Card,
    CardDivider,
    Chip,
    SectionLabel,
    Stepper,
    Switch,
    Textarea,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import {
    alarmsAvailable,
    openLockScreenSettings,
    setReminderAlarm,
    tryReminderAlarm,
    useLockScreenAllowed,
    useNotificationsAllowed,
    useReminderAlarm,
} from '../../notifications';
import { color, radius, space, Text } from '../../theme';
import { PlusIcon, WhatsAppIcon } from './components/icons';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { errorText } from './data/errors';
import {
    minutesFromTime,
    previewMessage,
    TEMPLATE_MAX,
    templateDraft,
    timeFromMinutes,
} from './data/reminders';

const TRY_ALARM_MS = 5000;

export function RemindersScreen({ onBack }: { onBack: () => void }) {
    const t = useT();
    const allowed = useNotificationsAllowed();
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const settings = useQuery(trpc.settings.get.queryOptions());

    const refetchSettings = () => queryClient.invalidateQueries(trpc.settings.pathFilter());

    const saveTiming = useMutation(trpc.settings.update.mutationOptions({ onSuccess: refetchSettings }));
    const saveTemplate = useMutation(trpc.settings.update.mutationOptions({ onSuccess: refetchSettings }));

    const [template, setTemplate] = useState<string | null>(null);

    const pull = usePullToRefresh(settings.refetch, settings.isFetching);

    const data = settings.data;
    const draft = templateDraft(template, data?.reminderTemplate);
    const text = draft.text;
    const notifyAt = data ? minutesFromTime(data.reminderNotifyAt) : 0;

    if (template !== null && data?.reminderTemplate === template.trim()) setTemplate(null);

    function editTemplate(next: string) {
        if (saveTemplate.isError) saveTemplate.reset();
        setTemplate(next);
    }

    const sent = saveTemplate.variables?.reminderTemplate;
    const confirming = saveTemplate.isSuccess && sent !== undefined && sent === template?.trim();
    const timing = usePendingAction((input: Parameters<typeof saveTiming.mutateAsync>[0]) =>
        saveTiming.mutateAsync(input),
    );
    const templateWrite = usePendingAction((input: Parameters<typeof saveTemplate.mutateAsync>[0]) =>
        saveTemplate.mutateAsync(input),
    );

    const write = timing.run;

    const savingTemplate = templateWrite.pending || confirming;

    return (
        <Pane title="Reminders" onBack={onBack} pull={pull} testID="settings-reminders">
            {settings.isLoading ? <SkeletonRows count={3} trailing /> : null}

            {settings.error ? (
                <ErrorState
                    message={errorText(settings.error)}
                    onRetry={settings.refetch}
                    retrying={settings.isFetching}
                />
            ) : null}

            {data ? (
                <>
                    {saveTiming.error ? (
                        <Callout tone="warning" title="Not saved">
                            {errorText(saveTiming.error)}
                        </Callout>
                    ) : null}

                    {allowed === 'blocked' ? (
                        <Callout tone="warning" title="Notifications are off for this app">
                            The daily reminder will not appear until notifications are turned on for Lustre
                            Clinic in Android settings. Everything below still saves.
                        </Callout>
                    ) : null}

                    <View style={styles.section}>
                        <SectionLabel inset={false}>TIMING</SectionLabel>

                        <Card>
                            <TimingRow
                                label="Remind before"
                                hint="Moves reminders not yet sent."
                                value={leadDaysOf(data.reminderLeadHours)}
                                min={1}
                                max={REMINDER_LEAD_MAX_DAYS}
                                format={(days) =>
                                    days === 1 ? t('1 day') : t('{count} days', { count: days })
                                }
                                onChange={(days) => write({ reminderLeadHours: leadHoursOf(days) })}
                                saving={timing.pending}
                                testID="reminder-lead"
                            />
                            <CardDivider />
                            <TimingRow
                                label="Notify me at"
                                hint="Lists everyone to remind today, all at once."
                                value={notifyAt}
                                min={6 * 60}
                                max={21 * 60}
                                step={60}
                                format={formatClock12}
                                onChange={(minutes) => write({ reminderNotifyAt: timeFromMinutes(minutes) })}
                                saving={timing.pending}
                                testID="reminder-notify"
                            />
                            <CardDivider />
                            <TimingRow
                                label="Repeat every"
                                hint="Stops when cleared, never overnight."
                                value={data.reminderRepeatMinutes}
                                min={15}
                                max={120}
                                step={15}
                                format={(minutes) => `${minutes} min`}
                                onChange={(reminderRepeatMinutes) => write({ reminderRepeatMinutes })}
                                saving={timing.pending}
                                testID="reminder-repeat"
                            />
                        </Card>
                    </View>

                    {alarmsAvailable ? <AlarmSection /> : null}

                    <View style={styles.section}>
                        <SectionLabel
                            inset={false}
                            action={
                                <Text
                                    variant="caption"
                                    weight="medium"
                                    tone={text.length > TEMPLATE_MAX ? 'due' : 'muted'}
                                    script="mono"
                                >
                                    {`${text.length} / ${TEMPLATE_MAX}`}
                                </Text>
                            }
                        >
                            MESSAGE TEMPLATE
                        </SectionLabel>

                        <Textarea
                            value={text}
                            onChangeText={editTemplate}
                            error={draft.issue ?? undefined}
                            accessibilityLabel="Reminder message template"
                            testID="reminder-template"
                        />

                        <View style={styles.tokens}>
                            {REMINDER_TOKENS.map((token) => (
                                <Chip
                                    key={token}
                                    variant="new"
                                    label={token}
                                    icon={<PlusIcon size={11} stroke={color.muted} width={2.6} />}
                                    onPress={() => editTemplate(`${text} ${token}`)}
                                    testID={`reminder-token-${token}`}
                                />
                            ))}
                        </View>

                        {saveTemplate.error ? (
                            <Callout tone="warning" title="Not saved">
                                {errorText(saveTemplate.error)}
                            </Callout>
                        ) : null}

                        {!draft.dirty && saveTemplate.isSuccess ? (
                            <Callout tone="reassurance" title="Saved">
                                Patients will get this wording from the next reminder on.
                            </Callout>
                        ) : null}

                        {draft.dirty || savingTemplate ? (
                            <Button
                                label="Save message"
                                onPress={() => templateWrite.run({ reminderTemplate: text.trim() })}
                                loading={savingTemplate}
                                disabled={!draft.canSave || savingTemplate}
                                block
                                testID="reminder-template-save"
                            />
                        ) : null}
                    </View>

                    <View style={styles.section}>
                        <SectionLabel inset={false}>PREVIEW</SectionLabel>

                        <View style={styles.preview}>
                            <View style={styles.previewHead}>
                                <WhatsAppIcon size={15} />
                                <Text variant="eyebrow" tone="inverse" style={styles.channel}>
                                    {t('WHATSAPP')}
                                </Text>
                                <Text variant="caption" tone="inverse" script="mono" style={styles.sendAt}>
                                    {formatClock12(notifyAt)}
                                </Text>
                            </View>

                            <View style={styles.bubble}>
                                <Text variant="callout">{previewMessage(text)}</Text>
                            </View>

                            <Text variant="caption" tone="inverse" script="mono" style={styles.sampleNote}>
                                {t('Sample patient — real values are filled per appointment.')}
                            </Text>
                        </View>
                    </View>
                </>
            ) : null}
        </Pane>
    );
}

function AlarmSection() {
    const t = useT();
    const alarm = useReminderAlarm();
    const lockScreen = useLockScreenAllowed();
    const { enabled: demo } = useDemoMode();
    const [trying, setTrying] = useState<'waiting' | 'refused' | null>(null);

    async function tryAlarm() {
        const armed = await tryReminderAlarm(TRY_ALARM_MS);
        setTrying(armed ? 'waiting' : 'refused');
        if (armed) setTimeout(() => setTrying(null), TRY_ALARM_MS);
    }

    return (
        <View style={styles.section}>
            <SectionLabel inset={false}>ON THIS PHONE</SectionLabel>
            <Card>
                <View style={styles.timing}>
                    <View style={styles.timingText}>
                        <Text variant="body" weight="medium">
                            {t('Ring like an alarm')}
                        </Text>
                        <Text variant="footnote" tone="muted">
                            {t(
                                'Rings at the alarm volume until you stop it, even on silent, and fills the lock screen.',
                            )}
                        </Text>
                    </View>
                    <Switch
                        value={alarm.enabled}
                        onValueChange={setReminderAlarm}
                        disabled={!alarm.hydrated}
                        accessibilityLabel={t('Ring like an alarm')}
                        testID="reminder-alarm"
                    />
                </View>
            </Card>

            {alarm.enabled && lockScreen === 'blocked' ? (
                <>
                    <Callout tone="warning" title="The alarm can't fill the lock screen">
                        Android is set to show it as a banner instead. It still rings.
                    </Callout>
                    <Button
                        label="Allow in Android settings"
                        variant="secondary"
                        onPress={openLockScreenSettings}
                        block
                        testID="reminder-alarm-lock-screen"
                    />
                </>
            ) : null}

            {demo ? (
                <>
                    <Button
                        label={trying === 'waiting' ? 'Rings in 5 seconds…' : 'Try the alarm'}
                        variant="secondary"
                        onPress={() => void tryAlarm()}
                        disabled={trying === 'waiting'}
                        block
                        testID="reminder-alarm-try"
                    />
                    <Text variant="footnote" tone="muted">
                        {t(
                            trying === 'refused'
                                ? 'Turn on notifications for Lustre Clinic first.'
                                : 'Lock the phone to see it fill the lock screen.',
                        )}
                    </Text>
                </>
            ) : null}
        </View>
    );
}

type TimingRowProps = {
    label: string;
    hint?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    format: (value: number) => string;
    onChange: (value: number) => void;
    saving: boolean;
    testID: string;
};

function TimingRow({ label, hint, value, min, max, step, format, onChange, saving, testID }: TimingRowProps) {
    const t = useT();
    return (
        <View style={styles.timing}>
            <View style={styles.timingText}>
                <Text variant="callout" weight="semibold">
                    {t(label)}
                </Text>
                {hint ? (
                    <Text variant="footnote" tone="muted">
                        {t(hint)}
                    </Text>
                ) : null}
            </View>

            <Stepper
                value={value}
                min={min}
                max={max}
                step={step}
                format={format}
                onChange={onChange}
                disabled={saving}
                accessibilityLabel={label}
                testID={testID}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: space[2] },

    timing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
    },
    timingText: { flex: 1, minWidth: 0, gap: space[0.5] },

    tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },

    preview: { padding: space[3.5], borderRadius: radius.xl2, backgroundColor: color.inkDeep },
    previewHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    channel: { flex: 1, opacity: 0.5 },
    sendAt: { opacity: 0.4 },

    bubble: {
        marginTop: space[3],
        paddingVertical: space[3],
        paddingHorizontal: space[3.5],
        borderRadius: radius.xl,
        borderEndStartRadius: space[1.5],
        backgroundColor: color.surface,
    },
    sampleNote: { marginTop: space[2.5], opacity: 0.42 },
});
