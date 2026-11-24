import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { getLocale } from '../../i18n/runtime';
import type { TextTone, TextVariant, TextWeight } from '../../theme';
import { space, Text } from '../../theme';
import { currencyLeads, currencyOf, formatEgp, type MoneyLocale } from './money';

export type MoneyValueProps = {
    amount: number;
    variant?: TextVariant;
    currencyVariant?: TextVariant;
    tone?: TextTone;
    weight?: TextWeight;
    compact?: boolean;
    locale?: MoneyLocale;
    showCurrency?: boolean;
    currencySuffix?: boolean;
    face?: 'sans' | 'mono';
    currencyStyle?: StyleProp<TextStyle>;
    style?: StyleProp<ViewStyle>;
    testID?: string;
};

export function MoneyValue({
    amount,
    variant = 'amount',
    currencyVariant,
    tone = 'ink',
    weight,
    compact = false,
    locale = getLocale(),
    showCurrency = true,
    currencySuffix = false,
    face = 'sans',
    currencyStyle,
    style,
    testID,
}: MoneyValueProps) {
    const figure = formatEgp(amount, { compact, locale, showCurrency: false });

    const figureText = (
        <Text variant={variant} tone={tone} weight={weight ?? 'bold'} script={face}>
            {figure}
        </Text>
    );

    if (!showCurrency) {
        return figureText;
    }

    const currencyText = (
        <Text variant={currencyVariant ?? variant} tone={tone} weight={weight} style={currencyStyle}>
            {currencyOf(locale)}
        </Text>
    );

    return (
        <View
            style={[styles.row, style]}
            testID={testID}
            accessible
            accessibilityLabel={formatEgp(amount, { locale })}
        >
            {currencyLeads(locale) && !currencySuffix ? (
                <>
                    {currencyText}
                    {figureText}
                </>
            ) : (
                <>
                    {figureText}
                    {currencyText}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
});
