import type { Locale } from '@lustre/shared';
import { StyleSheet, View } from 'react-native';
import { useLocale } from '../../i18n';
import { getLocale } from '../../i18n/runtime';
import type { TextTone, TextVariant, TextWeight } from '../../theme';
import { space, Text } from '../../theme';
import { CURRENCY, formatAmount, formatMoney as formatIn, type MoneyOptions } from './money';

export type MoneyValueProps = {
    piastres: number;
    compact?: boolean;
    variant?: TextVariant;
    weight?: TextWeight;
    tone?: TextTone;
    showCurrency?: boolean;
    language?: Locale;
    testID?: string;
};

const SYMBOL_VARIANT: Partial<Record<TextVariant, TextVariant>> = {
    display: 'callout',
    figure: 'callout',
    title: 'subhead',
    title2: 'subhead',
    title3: 'subhead',
    amount: 'footnote',
};

export function formatMoney(piastres: number, options: MoneyOptions = {}): string {
    return formatIn(piastres, { ...options, language: options.language ?? getLocale() });
}

export function MoneyValue({
    piastres,
    compact = false,
    variant = 'amount',
    weight,
    tone = 'ink',
    showCurrency = true,
    language,
    testID,
}: MoneyValueProps) {
    const appLocale = useLocale();
    const locale = language ?? appLocale;
    const amount = formatAmount(piastres, compact);

    const symbol = showCurrency ? (
        <Text variant={SYMBOL_VARIANT[variant] ?? 'caption'} tone={tone} script="sans">
            {CURRENCY[locale]}
        </Text>
    ) : null;

    const figure = (
        <Text variant={variant} weight={weight} tone={tone} script="mono">
            {amount}
        </Text>
    );

    return (
        <View
            style={styles.row}
            accessible
            accessibilityLabel={formatIn(piastres, { compact, language: locale })}
            testID={testID}
        >
            {locale === 'ar' ? (
                <>
                    {figure}
                    {symbol}
                </>
            ) : (
                <>
                    {symbol}
                    {figure}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
});
