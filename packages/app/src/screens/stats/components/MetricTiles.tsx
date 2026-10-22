// The four figures under the chart, two by two. Tapping one puts it on the
// chart. Not selected, a tile is its soft ground lifted off the page; selected,
// its solid colour with white text and a lift in the same colour, and the hint
// says it is the one being charted. A press sinks the tile a little, so it
// answers the finger before the chart redraws.
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, shadow, space, Text } from '../../../theme';
import { MoneyValue } from '../MoneyValue';
import { isMoney, METRIC_LABEL, METRICS, type Metric } from '../stats';
import { SKIN } from './skin';

const PRESSED = 0.96;
/** Width over height, from the design's tiles (174 × 120 on a 390-wide phone). */
const TILE_RATIO = 1.45;

export type MetricTilesProps = {
    figures: Record<Metric, number>;
    metric: Metric;
    onSelect: (metric: Metric) => void;
};

export function MetricTiles({ figures, metric, onSelect }: MetricTilesProps) {
    return (
        <View style={styles.grid}>
            {METRICS.map((key) => (
                <Tile
                    key={key}
                    metric={key}
                    value={figures[key]}
                    on={key === metric}
                    onPress={() => onSelect(key)}
                />
            ))}
        </View>
    );
}

function Tile({
    metric,
    value,
    on,
    onPress,
}: {
    metric: Metric;
    value: number;
    on: boolean;
    onPress: () => void;
}) {
    const t = useT();
    const skin = SKIN[metric];
    const tone = on ? 'inverse' : skin.text;
    const Glyph = skin.glyph;
    const scale = useRef(new Animated.Value(1)).current;
    const reducedMotion = useReducedMotion();

    const press = (to: number) => {
        if (reducedMotion) return;
        Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
    };

    return (
        <Animated.View style={[styles.cell, { transform: [{ scale }] }]}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={onPress}
                onPressIn={() => press(PRESSED)}
                onPressOut={() => press(1)}
                style={[
                    styles.tile,
                    { backgroundColor: on ? skin.solid : skin.soft, boxShadow: on ? skin.lift : shadow.card },
                ]}
                testID={`stats-tile-${metric}`}
            >
                <View style={styles.head}>
                    <Text
                        variant="eyebrow"
                        script="sans"
                        weight="bold"
                        tone={tone}
                        style={on ? styles.subOn : styles.sub}
                        numberOfLines={1}
                    >
                        {t(METRIC_LABEL[metric])}
                    </Text>
                    <Glyph size={18} color={on ? color.inverse : skin.textColor} strokeWidth={2} />
                </View>

                {isMoney(metric) ? (
                    <MoneyValue
                        amount={value}
                        variant="figure2"
                        currencyVariant="footnote"
                        weight="semibold"
                        tone={tone}
                        compact
                        currencySuffix
                        currencyStyle={styles.unit}
                    />
                ) : (
                    <Text variant="figure2" script="sans" weight="semibold" tone={tone}>
                        {String(value)}
                    </Text>
                )}

                <View style={styles.hint}>
                    {on ? <View style={styles.swatch} /> : null}
                    <Text
                        variant="footnote"
                        weight={on ? 'semibold' : 'medium'}
                        tone={tone}
                        style={on ? styles.subOn : styles.sub}
                        numberOfLines={1}
                    >
                        {t(on ? 'On the chart' : 'Tap to chart')}
                    </Text>
                </View>
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2.5] },
    cell: { flexBasis: '45%', flexGrow: 1 },
    // The design's shape, held whatever the phone's width: two to a row, a
    // wider screen only makes each tile wider, and without a ratio they turn
    // into strips. The figure and the hint sit at the ends.
    tile: {
        aspectRatio: TILE_RATIO,
        justifyContent: 'space-between',
        gap: space[2.5],
        padding: space[5],
        borderRadius: radius.xl3,
    },
    sub: { opacity: 0.75 },
    subOn: { opacity: 0.85 },
    unit: { opacity: 0.6 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
    hint: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    swatch: { width: 14, height: 3, borderRadius: radius.full, backgroundColor: color.inverse },
});
