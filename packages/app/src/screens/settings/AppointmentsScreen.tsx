import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from '@lustre/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTRPC } from '../../api';
import {
    Button,
    Callout,
    Card,
    CardDivider,
    Chip,
    NumericField,
    Radio,
    SectionLabel,
    Switch,
    Tag,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { color, radius, size, space, Text } from '../../theme';
import { CloseIcon, PlusIcon } from './components/icons';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { errorText } from './data/errors';

const QUICK_ADDS = [10, 25, 90] as const;

export function AppointmentsScreen({ onBack }: { onBack: () => void }) {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const settings = useQuery(trpc.settings.get.queryOptions());
    const [draft, setDraft] = useState('');

    const save = useMutation(
        trpc.settings.update.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(trpc.settings.pathFilter()),
        }),
    );

    const pull = usePullToRefresh(settings.refetch, settings.isFetching);

    const write = usePendingAction(
        async (patch: Parameters<typeof save.mutateAsync>[0], after?: () => void) => {
            await save.mutateAsync(patch);
            after?.();
        },
    );

    const data = settings.data;
    const durations = data?.durationOptions ?? [];
    const busy = write.pending;

    const acting = useRef<'add' | 'row'>('add');

    const drafted = Number.parseInt(draft, 10);
    const draftError = draftProblem(drafted, durations);

    function onAdd() {
        if (draftError !== undefined || !Number.isFinite(drafted)) return;

        acting.current = 'add';
        write.run({ durationOptions: [...durations, drafted].sort((a, b) => a - b) }, () => setDraft(''));
    }

    function onRemove(minutes: number) {
        acting.current = 'row';
        write.run({ durationOptions: durations.filter((d) => d !== minutes) });
    }

    function onSetDefault(minutes: number) {
        acting.current = 'row';
        write.run({ defaultDuration: minutes });
    }

    function onAskToEdit(on: boolean) {
        acting.current = 'row';
        write.run({ askToEditOnFinish: on });
    }

    return (
        <Pane title="Appointments" onBack={onBack} pull={pull} testID="settings-appointments">
            {settings.isLoading ? <SkeletonRows count={5} /> : null}

            {settings.error ? (
                <ErrorState
                    message={errorText(settings.error)}
                    onRetry={settings.refetch}
                    retrying={settings.isFetching}
                />
            ) : null}

            {data ? (
                <>
                    {save.error ? (
                        <Callout tone="warning" title="Not saved">
                            {errorText(save.error)}
                        </Callout>
                    ) : null}

                    <View style={styles.section}>
                        <SectionLabel
                            inset={false}
                            action={
                                <Text variant="caption" weight="medium" tone="muted">
                                    {t('Tap a circle to set the default')}
                                </Text>
                            }
                        >
                            DURATION OPTIONS
                        </SectionLabel>

                        <Card>
                            {durations.map((minutes, index) => {
                                const isDefault = minutes === data.defaultDuration;

                                return (
                                    <View key={minutes}>
                                        {index > 0 ? <CardDivider /> : null}
                                        <View style={[styles.row, isDefault && styles.defaultRow]}>
                                            <Radio
                                                selected={isDefault}
                                                onPress={() => onSetDefault(minutes)}
                                                disabled={busy}
                                                accessibilityLabel={t('Make {minutes} minutes the default', {
                                                    minutes,
                                                })}
                                                testID={`duration-default-${minutes}`}
                                            />

                                            <Text variant="amount" style={styles.minutes}>
                                                {String(minutes)}
                                            </Text>
                                            <Text variant="subhead" tone="muted">
                                                {t('min')}
                                            </Text>

                                            {isDefault ? <Tag tone="muted">DEFAULT</Tag> : null}

                                            <View style={styles.rowEnd}>
                                                {isDefault ? null : (
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        accessibilityLabel={t('Remove {minutes} minutes', {
                                                            minutes,
                                                        })}
                                                        onPress={() => onRemove(minutes)}
                                                        disabled={busy}
                                                        testID={`duration-remove-${minutes}`}
                                                        style={({ pressed }) => [
                                                            styles.remove,
                                                            pressed && styles.pressed,
                                                        ]}
                                                    >
                                                        <CloseIcon size={15} />
                                                    </Pressable>
                                                )}
                                            </View>
                                        </View>
                                    </View>
                                );
                            })}

                            <View style={styles.addRow}>
                                <View style={styles.addField}>
                                    <NumericField
                                        variant="end"
                                        suffix="min"
                                        value={draft}
                                        onChangeText={setDraft}
                                        placeholder="—"
                                        accessibilityLabel="New duration in minutes"
                                        error={draft.trim() === '' ? undefined : draftError}
                                        testID="duration-draft"
                                    />
                                </View>
                                <Button
                                    label="Add"
                                    onPress={onAdd}
                                    loading={busy && acting.current === 'add'}
                                    disabled={draft.trim() === '' || draftError !== undefined || busy}
                                    icon={<PlusIcon size={14} />}
                                    testID="duration-add"
                                />
                            </View>
                        </Card>

                        <View style={styles.quick}>
                            {QUICK_ADDS.filter((n) => !durations.includes(n)).map((n) => (
                                <Chip
                                    key={n}
                                    label={`+ ${n}`}
                                    onPress={() => setDraft(String(n))}
                                    testID={`duration-quick-${n}`}
                                />
                            ))}
                        </View>
                    </View>

                    <Card padded style={styles.defaultCard}>
                        <SectionLabel inset={false}>DEFAULT DURATION</SectionLabel>
                        <View style={styles.figure}>
                            <Text variant="figure">{String(data.defaultDuration)}</Text>
                            <Text variant="callout" tone="muted">
                                {t('min')}
                            </Text>
                        </View>
                        <Text variant="footnote" tone="muted">
                            {t('Pick another option first to remove it.')}
                        </Text>
                    </Card>

                    <View style={styles.section}>
                        <SectionLabel inset={false}>FINISHING A VISIT</SectionLabel>
                        <Card>
                            <View style={styles.flagRow}>
                                <View style={styles.flagText}>
                                    <Text variant="body" weight="medium">
                                        {t('Ask to edit procedures')}
                                    </Text>
                                    <Text variant="subhead" tone="muted">
                                        {t(
                                            'Finish asks the doctor whether the procedures need editing before the patient goes to the desk.',
                                        )}
                                    </Text>
                                </View>
                                <Switch
                                    value={data.askToEditOnFinish}
                                    onValueChange={onAskToEdit}
                                    disabled={busy}
                                    accessibilityLabel="Ask to edit procedures"
                                    testID="finish-ask-to-edit"
                                />
                            </View>
                        </Card>
                    </View>
                </>
            ) : null}
        </Pane>
    );
}

function draftProblem(minutes: number, offered: readonly number[]): string | undefined {
    if (!Number.isFinite(minutes)) return 'Whole minutes only.';
    if (minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
        return `Between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`;
    }
    if (offered.includes(minutes)) return 'That one is already offered.';
    return undefined;
}

const styles = StyleSheet.create({
    section: { gap: space[2] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[2],
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
    },
    defaultRow: { backgroundColor: color.canvas },
    minutes: { minWidth: 34 },
    rowEnd: { flex: 1, alignItems: 'flex-end' },
    remove: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
    },
    pressed: { backgroundColor: color.surface2 },

    addRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        padding: space[3],
        backgroundColor: color.canvas,
    },
    addField: { flex: 1 },

    quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },

    defaultCard: { gap: space[2] },
    flagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        minHeight: size.row,
    },
    flagText: { flex: 1, gap: space[1] },
    figure: { flexDirection: 'row', alignItems: 'baseline', gap: space[1.5] },
});
