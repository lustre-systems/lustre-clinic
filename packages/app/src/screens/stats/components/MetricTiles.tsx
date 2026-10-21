// The four figures under the chart, two by two. Tapping one puts it on the
// chart. Not selected, a tile is its soft ground; selected, its solid colour
// with white text and a lift in the same colour, and the hint says it is the
// one being charted.
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../../i18n';
import { color, radius, space, Text } from '../../../theme';
import { MoneyValue } from '../MoneyValue';
import { isMoney, METRIC_LABEL, METRICS, type Metric } from '../stats';
import { SKIN } from './skin';

export type MetricTilesProps = {
    figures: Record<Metric, number>;
    metric: Metric;
    onSelect: (metric: Metric) => void;
};

export function MetricTiles({ figures, metric, onSelect }: MetricTilesProps) {
    const t = useT();
    return (
        <View style={styles.grid}>
            {METRICS.map((key) => {
                const on = key === metric;
                const skin = SKIN[key];
                const tone = on ? 'inverse' : skin.text;
                return (
                    <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => onSelect(key)}
                        style={({ pressed }) => [
                            styles.tile,
                            { backgroundColor: on ? skin.solid : skin.soft },
                            on && { boxShadow: skin.lift },
                            pressed && styles.pressed,
                        ]}
                        testID={`stats-tile-${key}`}
                    >
                        <Text
                            variant="eyebrow"
                            script="sans"
                            weight="bold"
                            tone={tone}
                            style={on ? styles.subOn : styles.sub}
                            numberOfLines={1}
                        >
                            {t(METRIC_LABEL[key])}
                        </Text>

                        {isMoney(key) ? (
                            <MoneyValue
                                amount={figures[key]}
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
                                {String(figures[key])}
                            </Text>
                        )}

                        <View style={styles.hint}>
                            {on ? <View style={styles.swatch} /> : null}
                            <Text
                                variant="footnote"
                                weight={on ? 'semibold' : 'regular'}
                                tone={tone}
                                style={on ? styles.subOn : styles.sub}
                                numberOfLines={1}
                            >
                                {t(on ? 'On the chart' : 'Tap to chart')}
                            </Text>
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2.5] },
    tile: {
        flexBasis: '45%',
        flexGrow: 1,
        gap: space[2.5],
        padding: space[5],
        borderRadius: radius.xl3,
    },
    pressed: { opacity: 0.85 },
    sub: { opacity: 0.75 },
    subOn: { opacity: 0.85 },
    unit: { opacity: 0.6 },
    hint: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    swatch: { width: 14, height: 3, borderRadius: radius.full, backgroundColor: color.inverse },
});
