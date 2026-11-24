import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type RouterOutput, useTRPC } from '../../api';
import { formatSpan } from '../../components/domain';
import {
    Button,
    Callout,
    Card,
    CardDivider,
    Chevron,
    Select,
    Sheet,
    Switch,
    Tag,
    Toast,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { color, size, space, Text } from '../../theme';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { TimePickerField } from './components/TimePickerField';
import { errorText } from './data/errors';
import { minutesFromTime, timeFromMinutes } from './data/reminders';

type Branch = RouterOutput['branch']['list'][number];
type ClinicDay = RouterOutput['settings']['schedule'][number];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function daySpan(day: ClinicDay, locale: 'en' | 'ar'): string {
    return formatSpan(minutesFromTime(day.opensAt), minutesFromTime(day.closesAt), locale);
}

export function WorkingHoursScreen({ onBack }: { onBack: () => void }) {
    const trpc = useTRPC();
    const t = useT();

    const schedule = useQuery(trpc.settings.schedule.queryOptions());
    const branches = useQuery(trpc.branch.list.queryOptions({ includeInactive: true }));
    const [editing, setEditing] = useState<number | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const loading = schedule.isLoading || branches.isLoading;
    const error = schedule.error ?? branches.error;
    const byWeekday = new Map((schedule.data ?? []).map((day) => [day.weekday, day]));
    const branchName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? t('Unknown branch');

    function reload() {
        void schedule.refetch();
        void branches.refetch();
    }

    const pull = usePullToRefresh(reload, schedule.isFetching || branches.isFetching);

    return (
        <Pane
            title="Working hours"
            onBack={onBack}
            pull={pull}
            overlay={
                <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
            }
        >
            {loading ? <SkeletonRows count={7} trailing /> : null}

            {error ? (
                <ErrorState
                    message={errorText(error)}
                    onRetry={reload}
                    retrying={schedule.isFetching || branches.isFetching}
                />
            ) : null}

            {schedule.data && branches.data ? (
                <>
                    <Card>
                        {WEEKDAYS.map((name, weekday) => (
                            <View key={name}>
                                {weekday > 0 ? <CardDivider /> : null}
                                <DayRow
                                    name={t(name)}
                                    day={byWeekday.get(weekday)}
                                    branchName={branchName}
                                    onPress={() => setEditing(weekday)}
                                />
                            </View>
                        ))}
                    </Card>

                    <Text variant="footnote" tone="muted" style={styles.note}>
                        {t(
                            'These are the hours the day view draws and the booking screen defaults to. Booking outside them is still allowed.',
                        )}
                    </Text>
                </>
            ) : null}

            {editing !== null && branches.data ? (
                <DayEditor
                    weekday={editing}
                    name={t(WEEKDAYS[editing] ?? '')}
                    day={byWeekday.get(editing)}
                    branches={branches.data}
                    onClose={() => setEditing(null)}
                    onSaved={(message) => {
                        setEditing(null);
                        setToast(message);
                    }}
                />
            ) : null}
        </Pane>
    );
}

type DayRowProps = {
    name: string;
    day: ClinicDay | undefined;
    branchName: (id: string) => string;
    onPress: () => void;
};

function DayRow({ name, day, branchName, onPress }: DayRowProps) {
    const locale = useLocale();
    const t = useT();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={day ? `${name}, ${daySpan(day, locale)}` : `${name}, ${t('closed')}`}
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            <View style={styles.rowText}>
                <Text variant="body" weight="medium">
                    {name}
                </Text>
                {day ? (
                    <Text variant="subhead" tone="muted" numberOfLines={1}>
                        {branchName(day.branchId)}
                    </Text>
                ) : null}
            </View>

            {day ? (
                <Text variant="subhead" tone="ink2" script="mono" numberOfLines={1}>
                    {daySpan(day, locale)}
                </Text>
            ) : (
                <Tag tone="muted" variant="muted">
                    CLOSED
                </Tag>
            )}
            <Chevron direction="forward" tone="muted" />
        </Pressable>
    );
}

type DayEditorProps = {
    weekday: number;
    name: string;
    day: ClinicDay | undefined;
    branches: Branch[];
    onClose: () => void;
    onSaved: (message: string) => void;
};

function DayEditor({ weekday, name, day, branches, onClose, onSaved }: DayEditorProps) {
    const t = useT();
    const [open, setOpen] = useState(day !== undefined);
    const [branchId, setBranchId] = useState(day?.branchId ?? branches.find((b) => b.active)?.id ?? null);

    const [opens, setOpens] = useState(minutesFromTime(day?.opensAt ?? '10:00'));
    const [closes, setCloses] = useState(minutesFromTime(day?.closesAt ?? '18:00'));
    const openLabel = t('Open on {day}', { day: name });

    const options = branches
        .filter((branch) => branch.active || branch.id === day?.branchId)
        .map((branch) => ({
            value: branch.id,
            label: branch.active ? branch.name : t('{branch} (deactivated)', { branch: branch.name }),
        }));

    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const onSettingsWritten = () => queryClient.invalidateQueries(trpc.settings.pathFilter());

    const setDay = useMutation(trpc.settings.setDay.mutationOptions({ onSuccess: onSettingsWritten }));
    const clearDay = useMutation(trpc.settings.clearDay.mutationOptions({ onSuccess: onSettingsWritten }));

    const orderError = open && opens >= closes ? t('Closing time must be after opening.') : undefined;
    const canSave = !open || (branchId !== null && orderError === undefined);
    const write = usePendingAction((job: () => Promise<unknown>) => job());

    const pending = write.pending;
    const failure = setDay.error ?? clearDay.error;

    function onSave() {
        if (!open) {
            write.run(async () => {
                await clearDay.mutateAsync({ weekday });
                onSaved(t('{day} marked closed', { day: name }));
            });
            return;
        }
        if (!branchId) return;
        write.run(async () => {
            await setDay.mutateAsync({
                weekday,
                branchId,
                opensAt: timeFromMinutes(opens),
                closesAt: timeFromMinutes(closes),
            });
            onSaved(t('{day} saved', { day: name }));
        });
    }

    return (
        <Sheet
            visible
            onClose={pending ? () => {} : onClose}
            dismissable={!pending}
            title={name}
            subtitle={open ? 'Open this day' : 'Closed all day'}
            footer={<Button label="Save" onPress={onSave} loading={pending} disabled={!canSave} block />}
        >
            {failure ? (
                <Callout tone="warning" title="Not saved">
                    {errorText(failure, {
                        NOT_FOUND: 'That branch is no longer set up. Pick another one.',
                    })}
                </Callout>
            ) : null}

            <View style={styles.switchRow}>
                <View style={styles.rowText}>
                    <Text variant="body" weight="medium">
                        {openLabel}
                    </Text>
                    <Text variant="subhead" tone="muted">
                        {t('Off means closed all day.')}
                    </Text>
                </View>
                <Switch value={open} onValueChange={setOpen} accessibilityLabel={openLabel} />
            </View>

            {open ? (
                <>
                    <Select
                        label="Branch"
                        required
                        options={options}
                        value={branchId}
                        onChange={setBranchId}
                        placeholder="Pick a branch"
                        sheetTitle="Branch"
                    />
                    <TimePickerField label="Opens" value={opens} onChange={setOpens} />
                    <TimePickerField label="Closes" value={closes} onChange={setCloses} error={orderError} />
                </>
            ) : null}
        </Sheet>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[2],
    },
    pressed: { backgroundColor: color.surface2 },
    rowText: { flex: 1, gap: space[0.5] },
    note: { paddingHorizontal: space[1] },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.row },
});
