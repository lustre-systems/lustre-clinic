// A collected total and one row per payment method, from `balance.takings`
// less "other" (`shownTakings`), so the shares add up to 100%.
// Amounts are full, never compact (§7.12). Each row's share is a ratio, not
// money — nothing is summed here, and the percentage is never rendered as an
// amount. A method the clinic has never taken is absent rather than a zero row,
// so the list is as long as the period earns.
//
// The share label rides above the head of its own bar rather than sitting in a
// column: four bars of different lengths read as one comparison that way, and
// the caret is what ties a label to the bar it belongs to. It is positioned
// with `start`, not `left`, so it tracks the fill under RTL.
// biome-ignore lint/style/noRestrictedImports: animates the method bar's width to its new share, and stops it on cleanup
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { MethodIcon } from '../../../components/domain';
import { duration, easing, useReducedMotion } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, space, Text } from '../../../theme';
import type { MethodTaking, TakingsReport } from '../data';
import { methodLabel } from '../format';
import { MoneyValue } from '../MoneyValue';
import { hasShareBase, methodShare } from '../money';
import { BankIcon } from './icons';

const BAR_HEIGHT = 6;
const TILE = 32;
const CARET = 4;
const SHARE_LABEL = 44;

export type TakingsCardProps = {
    takings: TakingsReport;
    label: string;
};

export function TakingsCard({ takings, label }: TakingsCardProps) {
    const t = useT();
    const { total, byMethod } = takings;

    // Nothing came in is a period with no payment rows, not a period whose
    // total happens to be zero. Refunds are negative rows, so a day that took
    // 1,000 and gave 1,000 back nets to zero with two real movements on it —
    // "Nothing was collected" over them would be false.
    const nothingCollected = byMethod.length === 0;

    // Shares need a positive base. Without one the amounts are still the truth
    // and the split is not: see `methodShare`.
    const split = hasShareBase(total);

    return (
        <View style={styles.card} testID="stats-takings">
            <View style={styles.total}>
                <View style={styles.totalLabel}>
                    <Text variant="eyebrow" script="sans" weight="bold" tone="muted">
                        {label}
                    </Text>
                    <BankIcon />
                </View>

                {/* Green means money came in. A net refund is money going the
                    other way, so it is drawn neutral rather than as a negative
                    success. */}
                <MoneyValue
                    amount={total}
                    variant="figure"
                    currencyVariant="figure"
                    tone={total > 0 ? 'success' : 'ink'}
                />
            </View>

            {nothingCollected ? (
                <View style={styles.empty}>
                    <Text variant="subhead" tone="muted">
                        {t('Nothing was collected in this period.')}
                    </Text>
                </View>
            ) : (
                <View style={styles.methods}>
                    {byMethod.map((row) => (
                        <MethodRow key={row.method} row={row} total={total} split={split} />
                    ))}
                </View>
            )}

            {!nothingCollected && !split ? (
                <View style={styles.note}>
                    <Text variant="footnote" tone="muted">
                        {t('Refunds cancelled out what was taken, so there is no split to show.')}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function MethodRow({ row, total, split }: { row: MethodTaking; total: number; split: boolean }) {
    const t = useT();
    const share = methodShare(row.amount, total);
    const percent = Math.round(share * 100);

    const width = useRef(new Animated.Value(0)).current;
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        const animation = Animated.timing(width, {
            toValue: share,
            duration: reducedMotion ? 0 : duration.fadeup,
            easing: easing.standard,
            useNativeDriver: false,
        });

        animation.start();
        return () => animation.stop();
    }, [share, width, reducedMotion]);

    return (
        <View style={styles.methodRow} testID={`stats-method-${row.method}`}>
            <View style={styles.tile}>
                <MethodIcon method={row.method} />
            </View>

            <View style={styles.barCol}>
                {split ? (
                    <>
                        <View
                            style={styles.track}
                            accessibilityRole="progressbar"
                            accessibilityLabel={t('{method} share of takings', {
                                method: methodLabel(row.method),
                            })}
                            accessibilityValue={{ min: 0, max: 100, now: percent }}
                        >
                            <Animated.View
                                style={[
                                    styles.fill,
                                    {
                                        width: width.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: ['0%', '100%'],
                                        }),
                                    },
                                ]}
                            />
                        </View>

                        <View style={[styles.shareAnchor, { start: `${percent}%` }]} pointerEvents="none">
                            <Text variant="caption" weight="bold" tone="successText">
                                {`${percent}%`}
                            </Text>
                            <View style={styles.caret} />
                        </View>
                    </>
                ) : null}
            </View>

            {/* `MoneyValue` renders a bare Text when the currency is hidden, so
                the column's width belongs to a box around it. */}
            <View style={styles.amount}>
                <MoneyValue
                    amount={row.amount}
                    variant="body"
                    weight="bold"
                    tone="ink2"
                    showCurrency={false}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        alignSelf: 'stretch',
        padding: space[4.5],
        borderRadius: radius.xl3,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    total: {
        alignItems: 'flex-start',
        gap: space[1],
        paddingBottom: space[4.5],
        marginBottom: space[4.5],
        borderBottomWidth: 1,
        borderBottomColor: color.hair,
    },
    totalLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        alignSelf: 'stretch',
    },
    empty: { paddingVertical: space[4], alignItems: 'center' },

    methods: { gap: space[3.5] },
    methodRow: { flexDirection: 'row', alignItems: 'center', gap: space[2.5] },
    tile: {
        width: TILE,
        height: TILE,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: space[2],
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    barCol: { flex: 1, justifyContent: 'flex-end' },
    track: {
        height: BAR_HEIGHT,
        borderRadius: radius.full,
        overflow: 'hidden',
        backgroundColor: color.surface2,
    },
    fill: { height: '100%', borderRadius: radius.full, backgroundColor: color.success },

    // `start` puts the box's leading edge on the bar's head; the negative
    // margin pulls it back by half its width so the label centres there. A
    // zero-width box would centre too, but Android clips the overflow and the
    // label disappears.
    shareAnchor: {
        position: 'absolute',
        bottom: BAR_HEIGHT + CARET,
        width: SHARE_LABEL,
        marginStart: -SHARE_LABEL / 2,
        alignItems: 'center',
    },
    caret: {
        width: 0,
        height: 0,
        borderStartWidth: 3,
        borderEndWidth: 3,
        borderTopWidth: CARET,
        borderStartColor: color.transparent,
        borderEndColor: color.transparent,
        borderTopColor: color.successText,
    },
    amount: { minWidth: 52, alignItems: 'flex-end' },
    note: { paddingTop: space[3.5] },
});
