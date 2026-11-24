import { resolveLabel } from '@lustre/shared';
import { StyleSheet, View } from 'react-native';
import { Tag } from '../../../components/ui';
import { useLocale, useT } from '../../../i18n';
import { size, space, Text } from '../../../theme';
import type { CustomQuestion, QuestionnaireGapReason } from '../data/types';
import { displayAnswer, isReadOnly } from './customFields';

export type CustomAnswerRowProps = {
    question: CustomQuestion;
    value: unknown;
    gap?: QuestionnaireGapReason;
};

const GAP_LABEL: Partial<Record<QuestionnaireGapReason, string>> = {
    answer_no_longer_valid: 'ASK AGAIN',
};

export function CustomAnswerRow({ question, value, gap }: CustomAnswerRowProps) {
    const t = useT();
    const answer = displayAnswer(question, value);
    const gapLabel = gap === undefined ? undefined : GAP_LABEL[gap];
    const label = resolveLabel(question, useLocale());

    return (
        <View style={styles.row} testID={`answer-row-${question.key}`}>
            <View style={styles.label}>
                <Text variant="subhead" tone="muted" numberOfLines={2}>
                    {label}
                </Text>
                {question.required && (
                    <Text variant="subhead" tone="due">
                        {' *'}
                    </Text>
                )}
            </View>

            <View style={styles.value}>
                {answer === null ? (
                    <Text variant="callout" tone="muted">
                        —
                    </Text>
                ) : (
                    <Text variant="callout" weight="bold" style={styles.answer}>
                        {question.kind === 'boolean' ? t(answer) : answer}
                    </Text>
                )}

                {gapLabel !== undefined && (
                    <View>
                        <Tag tone={question.required ? 'due' : 'muted'} variant="filled">
                            {gapLabel}
                        </Tag>
                    </View>
                )}

                {answer !== null && isReadOnly(question) && (
                    <Text variant="caption" tone="muted">
                        {t('Read-only for now')}
                    </Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3.5],
        minHeight: size.row,
        paddingVertical: space[2.5],
    },
    label: { width: 150, flexDirection: 'row', alignItems: 'flex-start' },
    value: { flex: 1, alignItems: 'flex-end', gap: space[1] },
    answer: { textAlign: 'right' },
});
