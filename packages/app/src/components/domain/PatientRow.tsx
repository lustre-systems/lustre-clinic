import { Pressable, StyleSheet, View } from 'react-native';
import type { RouterOutput } from '../../api';
import { useT } from '../../i18n';
import { border, color, containsArabic, size, space, Text } from '../../theme';
import { Chevron } from '../ui';
import { GLYPH } from './icons';
import { formatMoney, MoneyValue } from './MoneyValue';
import { phoneText } from './phone';

type SearchedPatient = RouterOutput['patient']['search'][number];

export type PatientSummary = Pick<SearchedPatient, 'name' | 'phone'> &
    Partial<Pick<SearchedPatient, 'id' | 'age' | 'gender'>>;

export type PatientRowProps = {
    patient: PatientSummary;
    balance?: number;
    onPress?: () => void;
    testID?: string;
};

export function PatientRow({ patient, balance = 0, onPress, testID }: PatientRowProps) {
    const { id, name, phone, age, gender } = patient;
    const t = useT();

    const person = [
        age === null || age === undefined ? null : t('{age} y', { age }),
        gender && t(gender.charAt(0).toUpperCase() + gender.slice(1)),
    ]
        .filter((part): part is string => Boolean(part))
        .join(' ');

    const meta = [phone && phoneText(phone), person].filter(Boolean).join(' · ');
    const spoken = [
        name,
        phone,
        age === null || age === undefined ? null : t(age === 1 ? '1 year' : '{count} years', { count: age }),
        balance > 0 ? t('Owes {amount}', { amount: formatMoney(balance) }) : null,
    ]
        .filter(Boolean)
        .join(', ');

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={spoken}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={testID ?? (id ? `patient-row-${id}` : undefined)}
        >
            <View style={styles.text}>
                <Text variant="headline" weight="semibold" numberOfLines={1}>
                    {name}
                </Text>
                <Text
                    variant="footnote"
                    weight="medium"
                    tone="muted"
                    script={containsArabic(meta) ? undefined : 'mono'}
                    numberOfLines={1}
                >
                    {meta}
                </Text>
            </View>

            {balance > 0 ? (
                <View style={styles.due}>
                    <GLYPH.pay size={13} color={color.due} strokeWidth={2.2} />
                    <MoneyValue
                        piastres={balance}
                        variant="caption"
                        weight="medium"
                        tone="due"
                        showCurrency={false}
                    />
                </View>
            ) : null}

            <Chevron direction="forward" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: size.gutter,
        paddingVertical: space[3],
        backgroundColor: color.canvas,
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
    },
    pressed: { backgroundColor: color.surface2 },
    text: { flex: 1, minWidth: 0, gap: space[0.5], alignItems: 'flex-start' },
    due: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
});
