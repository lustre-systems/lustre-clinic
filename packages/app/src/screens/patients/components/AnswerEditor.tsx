import { resolveLabel } from '@lustre/shared';
import { StyleSheet, TextInput, View } from 'react-native';
import { Button, Placeholder, Select, TextField } from '../../../components/ui';
import { useLocale, useT } from '../../../i18n';
import { color, font, radius, size, space, Text, type } from '../../../theme';
import type { CustomQuestion } from '../data/types';
import type { DraftValue } from './customFields';
import { NO, YES } from './customFields';

export type AnswerEditorProps = {
    question: CustomQuestion;
    value: DraftValue;
    onChange: (value: DraftValue) => void;
    missing?: boolean;
    error?: string;
};

export function AnswerEditor({ question, value, onChange, missing = false, error }: AnswerEditorProps) {
    const label = resolveLabel(question, useLocale());

    return (
        <View style={styles.field}>
            <View style={styles.labelRow}>
                <Text variant="footnote" weight="medium" tone={missing ? 'due' : 'muted'}>
                    {label}
                </Text>
                {question.required ? (
                    <Text variant="footnote" weight="medium" tone={missing ? 'due' : 'muted'}>
                        {' *'}
                    </Text>
                ) : null}
            </View>

            <View style={styles.control}>
                <Control question={question} value={value} onChange={onChange} error={error} />
            </View>

            {error ? (
                <Text variant="caption" tone="danger" style={styles.error}>
                    {error}
                </Text>
            ) : null}
        </View>
    );
}

function Control({ question, value, onChange, error }: Omit<AnswerEditorProps, 'missing'>) {
    const label = resolveLabel(question, useLocale());

    switch (question.kind) {
        case 'boolean':
            return (
                <View style={styles.pair}>
                    <Button
                        label="Yes"
                        variant={value === YES ? 'primary' : 'secondary'}
                        size="md"
                        pressLockMs={0}
                        onPress={() => onChange(value === YES ? '' : YES)}
                        style={styles.half}
                        testID={`answer-${question.key}-yes`}
                    />
                    <Button
                        label="No"
                        variant={value === NO ? 'primary' : 'secondary'}
                        size="md"
                        pressLockMs={0}
                        onPress={() => onChange(value === NO ? '' : NO)}
                        style={styles.half}
                        testID={`answer-${question.key}-no`}
                    />
                </View>
            );

        case 'select':
            return (
                <Select
                    options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
                    value={value === '' ? null : value}
                    onChange={onChange}
                    placeholder="Not answered"
                    sheetTitle={label}
                    error={error}
                    testID={`answer-${question.key}`}
                />
            );

        case 'text':
            return (
                <TextField
                    value={value}
                    onChangeText={onChange}
                    placeholder="Not answered"
                    error={error}
                    testID={`answer-${question.key}`}
                />
            );

        case 'number':
            return <NumberBox question={question} value={value} onChange={onChange} error={error} />;

        case 'date':
            return null;
    }
}

function NumberBox({ question, value, onChange, error }: Omit<AnswerEditorProps, 'missing'>) {
    const label = resolveLabel(question, useLocale());

    return (
        <View style={[styles.box, error ? styles.errored : null]}>
            <View style={styles.inputWrap}>
                <TextInput
                    accessibilityLabel={label}
                    value={value}
                    onChangeText={onChange}
                    keyboardType="decimal-pad"
                    style={styles.number}
                    testID={`answer-${question.key}`}
                />
                <Placeholder text="Not answered" visible={value === ''} />
            </View>
        </View>
    );
}

export function ReadOnlyAnswer({ question, shown }: { question: CustomQuestion; shown: string | null }) {
    const t = useT();
    const label = resolveLabel(question, useLocale());

    return (
        <View style={styles.field}>
            <View style={styles.labelRow}>
                <Text variant="footnote" weight="medium" tone="muted">
                    {label}
                </Text>
            </View>

            <View style={[styles.control, styles.box, styles.readOnly]}>
                <Text variant="body" tone={shown === null ? 'muted' : 'ink'}>
                    {shown ?? t('Not answered')}
                </Text>
                <Text variant="caption" tone="muted">
                    {t('Read-only for now')}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    field: { paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: color.line },
    labelRow: { flexDirection: 'row', alignItems: 'center' },
    control: { paddingTop: space[2] },
    error: { paddingTop: space[1] },

    pair: { flexDirection: 'row', gap: space[2] },
    half: { flex: 1 },

    box: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        minHeight: size.control,
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    errored: { borderColor: color.danger },
    inputWrap: { flex: 1, justifyContent: 'center' },
    number: {
        ...type.body,
        alignSelf: 'stretch',
        color: color.ink,
        fontFamily: font.mono.medium,
        paddingVertical: space[2],
    },
    readOnly: {
        justifyContent: 'space-between',
        gap: space[2],
        backgroundColor: color.surface2,
        borderColor: color.hair,
    },
});
