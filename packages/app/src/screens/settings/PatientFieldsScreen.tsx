import { type QuestionKind, resolveLabel } from '@lustre/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type RouterOutput, useTRPC } from '../../api';
import {
    ActionBar,
    AddButton,
    Button,
    Callout,
    Card,
    CardDivider,
    Chevron,
    Chip,
    ConfirmSheet,
    EmptyState,
    ListEditor,
    PushView,
    ReorderControls,
    SectionLabel,
    Switch,
    Tag,
    TextField,
    Toast,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { useBackHandler } from '../../shell/useBackHandler';
import { color, radius, size, space, Text } from '../../theme';
import { PlusIcon, PowerIcon } from './components/icons';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { errorText } from './data/errors';

type CustomQuestion = RouterOutput['customQuestion']['list'][number];

function optionsOf(question: CustomQuestion): string[] {
    return Array.isArray(question.options) ? (question.options as string[]) : [];
}

const FIXED_DETAILS = ['Full name', 'Phone', 'Email', 'Age', 'Sex'] as const;

const KIND_LABEL: Record<QuestionKind, string> = {
    boolean: 'Yes / no',
    select: 'Dropdown',
    text: 'Short text',
    number: 'Number',
    date: 'Date',
};

const KINDS: readonly QuestionKind[] = ['boolean', 'select', 'text', 'number', 'date'];

export function PatientFieldsScreen({ onBack }: { onBack: () => void }) {
    const trpc = useTRPC();
    const t = useT();
    const queryClient = useQueryClient();

    const questions = useQuery(trpc.customQuestion.list.queryOptions({ includeInactive: true }));
    const [reordering, setReordering] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useBackHandler(() => {
        if (!reordering) return false;
        setReordering(false);
        return true;
    });

    const editing = useRouteStack<CustomQuestion | 'new'>();

    const reorder = useMutation(
        trpc.customQuestion.reorder.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(trpc.customQuestion.pathFilter()),
        }),
    );

    const rows = questions.data ?? [];
    const active = rows.filter((q) => q.active);
    const inactive = rows.filter((q) => !q.active);

    const moveRow = usePendingAction((input: Parameters<typeof reorder.mutateAsync>[0]) =>
        reorder.mutateAsync(input),
    );

    function move(index: number, delta: number) {
        const next = [...active];
        const moved = next[index];
        const target = next[index + delta];
        if (!moved || !target) return;
        next[index] = target;
        next[index + delta] = moved;
        moveRow.run({ ids: next.map((row) => row.id) });
    }

    const pull = usePullToRefresh(() => {
        if (reordering) return;
        void questions.refetch();
        void queryClient.invalidateQueries(trpc.settings.pathFilter());
    }, questions.isFetching);

    return (
        <>
            <Pane
                title="Patient fields"
                onBack={reordering ? () => setReordering(false) : onBack}
                pull={pull}
                trailing={
                    active.length > 1 ? (
                        <Button
                            label={reordering ? 'Done' : 'Reorder'}
                            variant="text"
                            size="md"
                            onPress={() => setReordering((on) => !on)}
                        />
                    ) : null
                }
                overlay={
                    <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
                }
            >
                <FixedDetailsCard />

                <RequirementsCard />

                {questions.isLoading ? <SkeletonRows count={3} /> : null}

                {questions.error ? (
                    <ErrorState
                        message={errorText(questions.error)}
                        onRetry={questions.refetch}
                        retrying={questions.isFetching}
                    />
                ) : null}

                {reorder.error ? (
                    <Callout tone="warning" title="Order not saved">
                        {errorText(reorder.error)}
                    </Callout>
                ) : null}

                {questions.data ? (
                    <>
                        <View style={styles.section}>
                            <SectionLabel inset={false} count={active.length}>
                                CLINIC QUESTIONS
                            </SectionLabel>

                            {reordering ? (
                                <Text variant="footnote" tone="muted" style={styles.note}>
                                    {t(
                                        'This is the order the questions appear on the patient record. Move them with the arrows.',
                                    )}
                                </Text>
                            ) : null}

                            {active.length === 0 ? (
                                <EmptyState
                                    weight="panel"
                                    icon={<PlusIcon size={22} stroke={color.ink2} width={2.2} />}
                                    title="No questions yet"
                                    body="Ask what you need on top of the built-in details — medical history, how they found you, anything."
                                    actionLabel="Add a question"
                                    onAction={() => editing.push('new')}
                                />
                            ) : (
                                <Card>
                                    {active.map((question, index) => (
                                        <View key={question.id}>
                                            {index > 0 ? <CardDivider /> : null}
                                            <QuestionRow
                                                question={question}
                                                reordering={reordering}
                                                reorderDisabled={moveRow.pending}
                                                isFirst={index === 0}
                                                isLast={index === active.length - 1}
                                                onPress={() => editing.push(question)}
                                                onMoveUp={() => move(index, -1)}
                                                onMoveDown={() => move(index, 1)}
                                            />
                                        </View>
                                    ))}
                                </Card>
                            )}
                        </View>

                        {active.length > 0 && !reordering ? (
                            <AddButton label="Add a question" onPress={() => editing.push('new')} />
                        ) : null}

                        {inactive.length > 0 ? (
                            <View style={styles.section}>
                                <SectionLabel inset={false} count={inactive.length}>
                                    DEACTIVATED
                                </SectionLabel>
                                <Card variant="dashed">
                                    {inactive.map((question, index) => (
                                        <View key={question.id}>
                                            {index > 0 ? <CardDivider /> : null}
                                            <QuestionRow
                                                question={question}
                                                reordering={false}
                                                reorderDisabled
                                                isFirst
                                                isLast
                                                onPress={() => editing.push(question)}
                                                onMoveUp={() => {}}
                                                onMoveDown={() => {}}
                                            />
                                        </View>
                                    ))}
                                </Card>
                                <Text variant="footnote" tone="muted" style={styles.note}>
                                    {t(
                                        'These stop being asked. The answers patients already gave are kept, and come back if the question does.',
                                    )}
                                </Text>
                            </View>
                        ) : null}
                    </>
                ) : null}
            </Pane>

            {rendered(editing.stack).map(({ id, route: question }, index) => (
                <PushView key={id} visible={isOpen(editing.stack, index)} onClosed={editing.settled}>
                    <QuestionEditor
                        question={question === 'new' ? null : question}
                        nextSortOrder={rows.length}
                        onClose={editing.pop}
                        onSaved={(message) => {
                            editing.pop();
                            setToast(message);
                        }}
                    />
                </PushView>
            ))}
        </>
    );
}

function FixedDetailsCard() {
    const t = useT();
    return (
        <View style={styles.section}>
            <SectionLabel inset={false}>ALWAYS ON THE RECORD</SectionLabel>
            <Card variant="dashed" padded style={styles.fixed}>
                <View style={styles.chips}>
                    {FIXED_DETAILS.map((detail) => (
                        <View key={detail} style={styles.fixedChip}>
                            <Text variant="subhead" tone="ink2">
                                {detail}
                            </Text>
                        </View>
                    ))}
                </View>
                <Text variant="footnote" tone="muted">
                    {t("Built in — these five can't be renamed, reordered or removed.")}
                </Text>
            </Card>
        </View>
    );
}

function RequirementsCard() {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const settings = useQuery(trpc.settings.get.queryOptions());
    const save = useMutation(
        trpc.settings.update.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(trpc.settings.pathFilter()),
        }),
    );
    const write = usePendingAction((patch: { requireAge: boolean } | { requireGender: boolean }) =>
        save.mutateAsync(patch),
    );

    if (settings.error) {
        return (
            <ErrorState
                message={errorText(settings.error)}
                onRetry={settings.refetch}
                retrying={settings.isFetching}
            />
        );
    }
    if (!settings.data) return null;
    const { requireAge, requireGender } = settings.data;

    return (
        <View style={styles.section}>
            <SectionLabel inset={false}>REQUIRED OR OPTIONAL</SectionLabel>

            {save.error ? (
                <Callout tone="warning" title="Not saved">
                    {errorText(save.error)}
                </Callout>
            ) : null}

            <Card>
                <RequirementRow
                    label="Age"
                    accessibilityLabel="Require an age"
                    value={requireAge}
                    disabled={write.pending}
                    onChange={(value) => write.run({ requireAge: value })}
                    testID="settings-require-age"
                />
                <CardDivider />
                <RequirementRow
                    label="Sex"
                    accessibilityLabel="Require a sex"
                    value={requireGender}
                    disabled={write.pending}
                    onChange={(value) => write.run({ requireGender: value })}
                    testID="settings-require-gender"
                />
            </Card>

            <Text variant="footnote" tone="muted" style={styles.note}>
                {t('A patient already on file is asked the next time their record is edited.')}
            </Text>
        </View>
    );
}

function RequirementRow({
    label,
    accessibilityLabel,
    value,
    disabled,
    onChange,
    testID,
}: {
    label: string;
    accessibilityLabel: string;
    value: boolean;
    disabled: boolean;
    onChange: (value: boolean) => void;
    testID: string;
}) {
    const t = useT();
    return (
        <View style={styles.flagRow}>
            <View style={styles.rowText}>
                <Text variant="body" weight="medium">
                    {t(label)}
                </Text>
                <Text variant="subhead" tone="muted">
                    {t(value ? 'Required' : 'Optional')}
                </Text>
            </View>
            <Switch
                value={value}
                onValueChange={onChange}
                disabled={disabled}
                accessibilityLabel={accessibilityLabel}
                testID={testID}
            />
        </View>
    );
}

type QuestionRowProps = {
    question: CustomQuestion;
    reordering: boolean;
    reorderDisabled: boolean;
    isFirst: boolean;
    isLast: boolean;
    onPress: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
};

function QuestionRow({
    question,
    reordering,
    reorderDisabled,
    isFirst,
    isLast,
    onPress,
    onMoveUp,
    onMoveDown,
}: QuestionRowProps) {
    const t = useT();
    const type =
        question.kind === 'select'
            ? t('Dropdown · {count} options', { count: optionsOf(question).length })
            : t(KIND_LABEL[question.kind]);

    const locale = useLocale();
    const shown = resolveLabel(question, locale);

    const body = (
        <View style={[styles.rowText, !question.active && styles.dimmed]}>
            <Text variant="body" weight="medium">
                {shown}
            </Text>
            <View style={styles.tags}>
                <Tag tone="muted">{type.toUpperCase()}</Tag>
                {question.required ? (
                    <Tag tone="ink" variant="filled">
                        REQUIRED
                    </Tag>
                ) : null}
                {question.active ? null : (
                    <Tag tone="muted" variant="muted">
                        INACTIVE
                    </Tag>
                )}
            </View>
        </View>
    );

    if (reordering) {
        return (
            <View style={styles.row}>
                {body}
                <ReorderControls
                    itemLabel={shown}
                    isFirst={isFirst || reorderDisabled}
                    isLast={isLast || reorderDisabled}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                />
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown}
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            {body}
            <Chevron direction="forward" tone="muted" />
        </Pressable>
    );
}

type QuestionEditorProps = {
    question: CustomQuestion | null;
    nextSortOrder: number;
    onClose: () => void;
    onSaved: (message: string) => void;
};

function QuestionEditor({ question, nextSortOrder, onClose, onSaved }: QuestionEditorProps) {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const onQuestionWritten = () => queryClient.invalidateQueries(trpc.customQuestion.pathFilter());

    const [label, setLabel] = useState(question?.label ?? '');
    const [labelAr, setLabelAr] = useState(question?.labelAr ?? '');
    const [key, setKey] = useState(question?.key ?? '');
    const [keyEdited, setKeyEdited] = useState(question !== null);
    const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'boolean');
    const [options, setOptions] = useState<string[]>(question ? optionsOf(question) : []);
    const [required, setRequired] = useState(question?.required ?? false);
    const [submitted, setSubmitted] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const create = useMutation(trpc.customQuestion.create.mutationOptions({ onSuccess: onQuestionWritten }));
    const update = useMutation(trpc.customQuestion.update.mutationOptions({ onSuccess: onQuestionWritten }));

    const labelError = submitted && label.trim() === '' ? 'A question needs to say something.' : undefined;
    const keyError =
        submitted && !/^[a-z][a-z0-9_]*$/.test(key)
            ? 'Lowercase letters, numbers and underscores. It has to start with a letter.'
            : undefined;
    const optionsError =
        submitted && kind === 'select' && options.length < 2 ? 'A dropdown needs at least two options.' : '';
    const write = usePendingAction((job: () => Promise<unknown>) => job());

    const saving = write.pending && !confirming;
    const busy = write.pending;
    const failure = create.error ?? update.error;

    function onChangeLabel(next: string) {
        setLabel(next);
        if (!keyEdited) setKey(toKey(next));
    }

    function onSave() {
        setSubmitted(true);
        if (label.trim() === '') return;
        if (!question && !/^[a-z][a-z0-9_]*$/.test(key)) return;
        if (kind === 'select' && options.length < 2) return;

        write.run(async () => {
            if (question) {
                await update.mutateAsync({
                    id: question.id,
                    label: label.trim(),
                    labelAr,
                    options: kind === 'select' ? options : undefined,
                    required,
                });
                onSaved('Question saved');
                return;
            }

            await create.mutateAsync({
                key,
                label: label.trim(),
                labelAr,
                kind,
                options: kind === 'select' ? options : null,
                required,
                sortOrder: nextSortOrder,
            });
            onSaved('Question added');
        });
    }

    function onToggleActive() {
        if (!question) return;
        write.run(async () => {
            const updated = await update.mutateAsync({ id: question.id, active: !question.active });
            setConfirming(false);
            onSaved(updated.active ? 'Question reactivated' : 'Question deactivated');
        });
    }

    useBackHandler(() => {
        if (!busy) onClose();
        return true;
    });

    return (
        <Pane
            title={question ? 'Edit question' : 'New question'}
            onBack={busy ? () => {} : onClose}
            footer={
                <ActionBar
                    primaryLabel={saving ? 'Saving' : 'Save'}
                    onPrimary={onSave}
                    primaryLoading={saving}
                    primaryDisabled={busy}
                    secondaryLabel="Cancel"
                    onSecondary={busy ? undefined : onClose}
                />
            }
        >
            {failure ? (
                <Callout tone="warning" title="Not saved">
                    {errorText(failure)}
                </Callout>
            ) : null}

            <View style={styles.section}>
                <SectionLabel inset={false}>QUESTION</SectionLabel>
                <View style={styles.labelPair}>
                    <TextField
                        value={label}
                        onChangeText={onChangeLabel}
                        label="In English"
                        placeholder="Diabetic?"
                        error={labelError}
                    />
                    <TextField
                        value={labelAr}
                        onChangeText={setLabelAr}
                        label="In Arabic"
                        placeholder="هل تعاني من السكري؟"
                    />
                </View>
            </View>

            {question ? null : (
                <View style={styles.section}>
                    <SectionLabel inset={false}>STORED AS</SectionLabel>
                    <TextField
                        value={key}
                        onChangeText={(next) => {
                            setKeyEdited(true);
                            setKey(next);
                        }}
                        placeholder="diabetic"
                        accessibilityLabel="Stored as"
                        autoCapitalize="none"
                        autoCorrect={false}
                        error={keyError}
                        hint="Answers are filed under this. It can't change later."
                    />
                </View>
            )}

            <View style={styles.section}>
                <SectionLabel inset={false}>ANSWER TYPE</SectionLabel>
                <View style={styles.chips}>
                    {KINDS.map((option) => (
                        <Chip
                            key={option}
                            label={KIND_LABEL[option]}
                            selected={kind === option}
                            disabled={question !== null}
                            onPress={() => setKind(option)}
                        />
                    ))}
                </View>
                {question ? (
                    <Text variant="footnote" tone="muted" style={styles.note}>
                        {t('Fixed once patients have answered.')}
                    </Text>
                ) : null}
            </View>

            {kind === 'select' ? (
                <View style={styles.section}>
                    <SectionLabel inset={false}>OPTIONS</SectionLabel>
                    <ListEditor
                        items={options}
                        onChange={setOptions}
                        placeholder="Facebook"
                        addLabel="Add"
                        minItems={2}
                        minItemsHint={optionsError || 'Add at least two options.'}
                    />
                </View>
            ) : null}

            <View style={styles.section}>
                <SectionLabel inset={false}>REQUIRED</SectionLabel>
                <Card>
                    <View style={styles.flagRow}>
                        <Text variant="body" style={styles.rowText}>
                            {t('Required')}
                        </Text>
                        <Switch value={required} onValueChange={setRequired} accessibilityLabel="Required" />
                    </View>
                </Card>
            </View>

            {question ? (
                <Button
                    label={question.active ? 'Deactivate question' : 'Reactivate question'}
                    variant={question.active ? 'danger' : 'secondary'}
                    icon={
                        <PowerIcon
                            size={15}
                            stroke={question.active ? color.danger : color.ink}
                            width={2.2}
                        />
                    }
                    onPress={() => setConfirming(true)}
                    loading={write.pending && confirming}
                    block
                />
            ) : null}

            <ConfirmSheet
                visible={confirming}
                title={question?.active ? 'Deactivate this question?' : 'Reactivate this question?'}
                body={
                    question?.active
                        ? 'It stops being asked on new and existing records. Nothing is erased — every answer stays where it is, and comes back if you turn it on again.'
                        : 'It is asked again, and the answers already given show up again.'
                }
                confirmLabel={question?.active ? 'Deactivate' : 'Reactivate'}
                destructive={question?.active}
                loading={write.pending && confirming}
                onConfirm={onToggleActive}
                onCancel={() => setConfirming(false)}
            />
        </Pane>
    );
}

function toKey(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
}

const styles = StyleSheet.create({
    section: { gap: space[2] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[2],
    },
    pressed: { backgroundColor: color.surface2 },
    rowText: { flex: 1, gap: space[1] },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
    dimmed: { opacity: 0.5 },
    note: { paddingHorizontal: space[1] },
    labelPair: { gap: space[2] },
    fixed: { gap: space[3] },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    fixedChip: {
        paddingHorizontal: space[3],
        paddingVertical: space[1.5],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    flagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        minHeight: size.row,
    },
});
