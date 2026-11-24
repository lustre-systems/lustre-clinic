import { resolveLabel } from '@lustre/shared';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
    Button,
    Callout,
    EmptyState,
    ProgressBar,
    SkeletonRows,
    Textarea,
    useKeyboardHeight,
} from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { useRole } from '../../shell/useRole';
import { border, color, radius, size, space, Text } from '../../theme';
import { AnswerEditor, ReadOnlyAnswer } from './components/AnswerEditor';
import { BasicsCard } from './components/BasicsCard';
import { displayAnswer, isEditable } from './components/customFields';
import { CloseIcon, RetryIcon } from './components/icons';
import { OldPatientRows } from './components/OldPatientCard';
import { patientsApi } from './data/api';
import { errorText } from './data/errors';
import { useMutation, useQuery } from './data/hooks';
import type { CustomQuestion, PatientDetail } from './data/types';
import type { PatientForm, PatientPrefill, PatientRequirements } from './patientForm';
import {
    answeredCount,
    blankBasics,
    blankOld,
    clearedRequired,
    createInputOf,
    emptyForm,
    formOf,
    isUnchanged,
    MAX_NOTES_LENGTH,
    malformedBasics,
    malformedOld,
    missingRequired,
    refBaselineOf,
    refEditError,
    refEditOf,
    saveFailureTitle,
    unaskableRequired,
    updateInputOf,
} from './patientForm';

export type PatientEditScreenProps = {
    patientId?: string;
    prefill?: PatientPrefill;
    onCancel: () => void;
    onSavingChange?: (saving: boolean) => void;
    onSaved: (patientId: string, basics?: { name: string; phone: string }) => void;
};

export function PatientEditScreen({
    patientId,
    prefill,
    onCancel,
    onSavingChange,
    onSaved,
}: PatientEditScreenProps) {
    const t = useT();
    const creating = patientId === undefined;

    const questions = useQuery(['questions'], () => patientsApi.listQuestions());
    const requirements = useQuery(['requirements'], () => patientsApi.requirements());
    const record = useQuery(
        ['byId', patientId],
        (): Promise<PatientDetail | undefined> =>
            patientId === undefined ? Promise.resolve(undefined) : patientsApi.byId(patientId),
        { enabled: patientId !== undefined },
    );

    const create = useMutation(patientsApi.create);
    const update = useMutation(patientsApi.update);
    const editRef = useMutation(patientsApi.updateRef);
    const save = creating ? create : update;

    const saveError = editRef.error ?? save.error;
    const saving = save.pending || editRef.pending;

    const { role, hydrated } = useRole();
    const refMode = creating ? 'hidden' : hydrated ? 'editable' : 'locked';

    const editable = useMemo(() => (questions.data ?? []).filter(isEditable), [questions.data]);
    const readOnly = useMemo(
        () => (questions.data ?? []).filter((question) => !isEditable(question)),
        [questions.data],
    );

    const initial = useMemo<PatientForm | null>(() => {
        if (!questions.data || !requirements.data) return null;
        if (creating) return emptyForm(editable, prefill);
        return record.data ? formOf(record.data.patient, editable) : null;
    }, [creating, prefill, questions.data, requirements.data, record.data, editable]);

    const [form, setForm] = useState<PatientForm | null>(null);
    const [seededRef, setSeededRef] = useState<string | null>(null);
    if (form === null && initial !== null) {
        setForm(initial);
        setSeededRef(initial.ref);
    }

    const [savedRef, setSavedRef] = useState<string | null>(null);
    const refBaseline = refBaselineOf(initial, seededRef, savedRef);

    const loading = questions.loading || requirements.loading || record.loading;
    const failed = questions.error ?? requirements.error ?? record.error;

    const requires: PatientRequirements | undefined = requirements.data;
    const blank = form && requires ? blankBasics(form, requires) : [];
    const malformed = form ? malformedBasics(form) : {};
    const oldBlank = form && creating ? blankOld(form) : [];
    const oldMalformed = form && creating ? malformedOld(form) : {};
    const missing = form ? missingRequired(form, editable) : [];
    const answered = form ? answeredCount(form, editable) : 0;

    const refMessage =
        form && refBaseline && refMode === 'editable'
            ? (refEditError(form, refBaseline) ?? undefined)
            : undefined;

    const cleared = form && initial ? clearedRequired(form, initial, editable) : [];

    const owed =
        blank.length +
        Object.keys(malformed).length +
        oldBlank.length +
        Object.keys(oldMalformed).length +
        (refMessage === undefined ? 0 : 1) +
        (creating ? missing.length : cleared.length);

    const locale = useLocale();
    const unaskable = creating ? unaskableRequired(questions.data ?? []) : [];

    const change = (patch: Partial<PatientForm>) =>
        setForm((current) => (current ? { ...current, ...patch } : current));

    const answer = (key: string, value: string) =>
        setForm((current) =>
            current ? { ...current, answers: { ...current.answers, [key]: value } } : current,
        );

    const onSave = async () => {
        if (!form || !initial || !requires || owed > 0 || unaskable.length > 0) return;

        if (creating) {
            const input = createInputOf(form, editable, requires);
            if (input === null) return;
            onSavingChange?.(true);
            const saved = await create.mutate(input);
            onSavingChange?.(false);
            if (!saved) return;
            onSaved(saved.id, { name: input.name, phone: input.phone });
            return;
        }

        const patch = updateInputOf(patientId, form, initial, editable, requires);
        if (patch === null) return;

        const ref = refMode === 'editable' && refBaseline ? refEditOf(form, refBaseline) : null;

        if (isUnchanged(patch) && ref === null) {
            onSaved(patientId);
            return;
        }

        onSavingChange?.(true);

        if (ref === null) {
            editRef.reset();
        } else {
            const moved = await editRef.mutate({ id: patientId, ref, editedBy: role });
            if (!moved) {
                onSavingChange?.(false);
                return;
            }
            setSavedRef(moved.ref);
        }

        if (!isUnchanged(patch)) {
            const saved = await update.mutate(patch);
            if (!saved) {
                onSavingChange?.(false);
                return;
            }
        }

        onSavingChange?.(false);
        onSaved(patientId);
    };

    return (
        <View style={styles.screen}>
            <EditBar
                title={creating ? 'New patient' : 'Edit patient'}
                onCancel={saving ? undefined : onCancel}
            />

            {loading && !form ? (
                <SkeletonRows count={5} gutter={size.gutter} ruled />
            ) : failed && !form ? (
                <EmptyState
                    icon={<RetryIcon size={22} stroke={color.ink2} />}
                    title={creating ? 'Could not open the form' : 'Could not open this record'}
                    body={errorText(failed)}
                    actionLabel="Try again"
                    onAction={() => {
                        questions.refetch();
                        requirements.refetch();
                        record.refetch();
                    }}
                    weight="panel"
                />
            ) : form ? (
                <>
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.content}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        showsVerticalScrollIndicator={false}
                        stickyHeaderIndices={saveError !== undefined ? [0] : undefined}
                    >
                        {saveError !== undefined && (
                            <View style={[styles.callout, styles.sticky]}>
                                <Callout
                                    tone="warning"
                                    title={saveFailureTitle(editRef.error !== undefined, savedRef !== null)}
                                >
                                    {errorText(saveError)}
                                </Callout>
                            </View>
                        )}

                        {unaskable.length > 0 && (
                            <View style={styles.callout}>
                                <Callout tone="warning" title="This form cannot be completed">
                                    {t(
                                        unaskable.length === 1
                                            ? '{questions} is required, and cannot be answered here yet. Make it optional in Settings to register someone.'
                                            : '{questions} are required, and cannot be answered here yet. Make them optional in Settings to register someone.',
                                        {
                                            questions: unaskable
                                                .map((question) => resolveLabel(question, locale))
                                                .join(locale === 'ar' ? '، ' : ', '),
                                        },
                                    )}
                                </Callout>
                            </View>
                        )}

                        <Text variant="eyebrow" tone="muted" style={styles.eyebrow}>
                            {t('BASICS')}
                        </Text>

                        <BasicsCard
                            form={form}
                            onChange={change}
                            blank={blank}
                            errors={malformed}
                            ref={refMode}
                            refError={refMessage}
                            trailing={
                                creating ? (
                                    <OldPatientRows
                                        form={form}
                                        onChange={change}
                                        blank={oldBlank}
                                        errors={oldMalformed}
                                    />
                                ) : null
                            }
                        />

                        <Questions
                            questions={editable}
                            readOnly={readOnly}
                            stored={record.data?.patient.custom ?? {}}
                            form={form}
                            answered={answered}
                            missing={missing}
                            onAnswer={answer}
                            loading={questions.loading && !questions.data}
                            error={questions.error}
                        />

                        <View style={styles.section}>
                            <Text variant="eyebrow" tone="muted" style={styles.eyebrow}>
                                {t('NOTES')}
                            </Text>
                            <Textarea
                                accessibilityLabel={t('Patient notes')}
                                placeholder="Anything the clinic should know"
                                value={form.notes}
                                onChangeText={(notes) => change({ notes })}
                                maxLength={MAX_NOTES_LENGTH}
                                editable={!saving}
                                testID="patient-notes-input"
                            />
                        </View>
                    </ScrollView>

                    <SaveBar
                        label={owed > 0 ? t('{count} required left', { count: owed }) : 'Save patient'}
                        disabled={owed > 0 || unaskable.length > 0}
                        pending={saving}
                        onPress={onSave}
                    />
                </>
            ) : null}
        </View>
    );
}

function EditBar({ title, onCancel }: { title: string; onCancel?: () => void }) {
    return (
        <View style={styles.bar}>
            {onCancel ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    onPress={onCancel}
                    hitSlop={10}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    testID="patient-edit-cancel"
                >
                    <CloseIcon size={15} stroke={color.ink} />
                </Pressable>
            ) : (
                <View style={styles.iconButton} />
            )}

            <Text variant="headline" accessibilityRole="header">
                {title}
            </Text>
        </View>
    );
}

type QuestionsProps = {
    questions: CustomQuestion[];
    readOnly: CustomQuestion[];
    stored: Record<string, unknown>;
    form: PatientForm;
    answered: number;
    missing: string[];
    onAnswer: (key: string, value: string) => void;
    loading: boolean;
    error?: Error;
};

function Questions({
    questions,
    readOnly,
    stored,
    form,
    answered,
    missing,
    onAnswer,
    loading,
    error,
}: QuestionsProps) {
    const t = useT();
    const missingKeys = useMemo(() => new Set(missing), [missing]);
    const total = questions.length;

    if (loading) {
        return (
            <View style={styles.section}>
                <SkeletonRows count={3} gutter={0} ruled />
            </View>
        );
    }

    if (error && total === 0) {
        return (
            <View style={styles.section}>
                <EmptyState
                    title="Could not load the clinic's questions"
                    body={errorText(error)}
                    weight="line"
                />
            </View>
        );
    }

    if (total === 0 && readOnly.length === 0) {
        return (
            <View style={styles.section}>
                <EmptyState
                    title="No questions set up"
                    body="Questions the clinic adds in settings appear here for every patient."
                    weight="line"
                />
            </View>
        );
    }

    return (
        <View style={styles.section}>
            <View style={styles.sectionHead}>
                <Text variant="eyebrow" tone="muted">
                    {t('CLINIC QUESTIONS')}
                </Text>
                <Text variant="caption" weight="medium" tone="muted">
                    {t('{answered} of {total} answered', { answered, total })}
                </Text>
            </View>

            <ProgressBar
                value={total === 0 ? 0 : answered / total}
                accessibilityLabel={t('{answered} of {total} questions answered', { answered, total })}
            />

            <View style={styles.questions}>
                {questions.map((question) => (
                    <AnswerEditor
                        key={question.key}
                        question={question}
                        value={form.answers[question.key] ?? ''}
                        onChange={(value) => onAnswer(question.key, value)}
                        missing={missingKeys.has(question.key)}
                    />
                ))}

                {readOnly.map((question) => (
                    <ReadOnlyAnswer
                        key={question.key}
                        question={question}
                        shown={displayAnswer(question, stored[question.key])}
                    />
                ))}
            </View>

            <Text variant="caption" tone="muted" style={styles.footnote}>
                {t(
                    'Answers are kept on the record. Nothing here is ever deleted — a question the clinic stops asking keeps its answer and stops showing.',
                )}
            </Text>
        </View>
    );
}

function SaveBar({
    label,
    disabled,
    pending,
    onPress,
}: {
    label: string;
    disabled: boolean;
    pending: boolean;
    onPress: () => void;
}) {
    const keyboard = useKeyboardHeight();

    return (
        <View style={[styles.saveBar, { paddingBottom: Math.max(space[3], keyboard) }]}>
            <Button
                label={pending ? 'Saving…' : label}
                onPress={onPress}
                size="md"
                loading={pending}
                disabled={disabled}
                block
                style={styles.save}
                testID="patient-save"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    scroll: { flex: 1 },
    content: { paddingHorizontal: size.gutter, paddingTop: space[1], paddingBottom: space[6] },

    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingTop: space[2],
        paddingBottom: space[3],
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
    pressed: { opacity: 0.6 },

    callout: { paddingBottom: space[3] },
    sticky: { backgroundColor: color.canvas, paddingTop: space[1] },
    eyebrow: { paddingBottom: space[1.5] },

    section: { paddingTop: space[4] },
    sectionHead: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[2.5],
        paddingBottom: space[1.5],
    },
    questions: { paddingTop: space[1] },
    footnote: { paddingTop: space[3] },

    saveBar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        borderTopWidth: border.hair,
        borderTopColor: color.line,
        backgroundColor: color.canvas,
    },
    save: { minHeight: size.control },
});
