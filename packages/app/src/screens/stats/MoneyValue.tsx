// The money cluster's own money renderer. `components/domain/MoneyValue` has
// landed and this is deliberately not it — yet. The two agree on every rule
// that decides a figure (piastres in, whole pounds out, Latin numerals, `ج.م`
// trailing in Arabic) and disagree on everything the money designs need from
// the props: `currencyVariant`, `currencySuffix`, `currencyStyle` and `weight`,
// none of which the shared one carries, and a figure face — the shared one
// pins DM Mono per §7.11, these screens are drawn in Instrument Sans. Folding
// them together means widening the shared component and re-deciding the face
// for the day view and the patient rows at the same time, which is a call for
// whoever owns `components/domain`, not a side effect of wiring up the server.
//
// This is the only place the cluster turns an amount into text; the arithmetic
// lives in `money.ts`, which has no React Native import and is testable. The figure and
// the currency are separate Texts, and both take Instrument Sans: §7.11 put
// money in DM Mono for tabular alignment, but the money designs set every
// figure in the sans face and that is what these screens are held against, so
// the mono is opt-in through `face` rather than the default. `ج.م` has no mono
// coverage either way. Child order is locale-driven and the row is a plain `row`, never
// `row-reverse`: Yoga mirrors `row` under RTL and un-mirrors `row-reverse`, so
// a plain row makes one child order correct in both directions. The
// screen-reader label is always the full figure, never the compact one.
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
    // The hero rows and the stat cards draw EGP as a small unit riding after
    // the figure rather than as a leading currency mark, in both languages —
    // §7.13 governs where the *currency* sits, and a unit is not that. Every
    // other caller leaves this alone and gets the locale's placement.
    currencySuffix?: boolean;
    /**
     * The figure's face. `sans` is the default because that is what the money
     * designs draw and what these screens are held against; `mono` is here for
     * a column of amounts that has to align digit for digit.
     */
    face?: 'sans' | 'mono';
    /** For the unit's own weight against the figure — the design dims it. */
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
