import type { Locale } from '@lustre/shared';
import { StyleSheet, View } from 'react-native';
import { useLocale } from '../../i18n';
import type { TextTone, TextVariant, TextWeight } from '../../theme';
import { space, Text } from '../../theme';
import { clock12, formatClock12 } from './clock';

export type TimeValueProps = {
    minutes: number;
    variant?: TextVariant;
    weight?: TextWeight;
    tone?: TextTone;
    showMeridiem?: boolean;
    language?: Locale;
    testID?: string;
};

const MERIDIEM_VARIANT: Partial<Record<TextVariant, TextVariant>> = {
    display: 'callout',
    figure: 'callout',
    figure2: 'callout',
    title: 'subhead',
    title2: 'subhead',
    title3: 'subhead',
    amount: 'tag',
    headline: 'tag',
};

export function TimeValue({
    minutes,
    variant = 'amount',
    weight,
    tone = 'ink',
    showMeridiem = true,
    language,
    testID,
}: TimeValueProps) {
    const appLocale = useLocale();
    const locale = language ?? appLocale;
    const { time, meridiem } = clock12(minutes, locale);

    const figure = (
        <Text variant={variant} weight={weight} tone={tone} script="mono">
            {time}
        </Text>
    );

    return (
        <View
            style={styles.row}
            accessible
            accessibilityLabel={formatClock12(minutes, locale)}
            testID={testID}
        >
            {figure}
            {showMeridiem ? (
                <Text
                    variant={MERIDIEM_VARIANT[variant] ?? 'caption'}
                    tone={tone}
                    script={locale === 'ar' ? 'arabic' : 'sans'}
                >
                    {meridiem}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
});
