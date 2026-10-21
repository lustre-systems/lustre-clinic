// The black chart card at the top of the stats screen: the metric and point in
// the header with its figure and the change on the point before it, then a line
// over the period's points. Tapping a point selects it everywhere on the screen.
//
// The line is drawn left to right in English and right to left in Arabic, the
// way the pills and the bars read. The SVG does not mirror by itself, so its
// x is flipped here; the overlays (the tap targets, the tag over the selected
// point and the axis labels) sit on `start`, which the layout mirrors for us.
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useIsRTL, useLocale, useT } from '../../../i18n';
import { color, radius, shadow, space, Text } from '../../../theme';
import { currencyOf, formatEgp } from '../money';
import { chartPoints, type Delta, isMoney, METRIC_LABEL, type Metric } from '../stats';
import { SKIN } from './skin';

const HEIGHT = 120;
const PAD = 18;
const TOP = 28;
const BOTTOM = 30;
const AXIS = 22;
const HIT = 44;
const TAG = 80;

export type StatsChartProps = {
    metric: Metric;
    /** The header's figure: the selected point's, or the whole period's when nothing is selected. */
    value: number;
    /** What the figure is of, after the metric: "This month", "All time". */
    name: string;
    delta: Delta | null;
    /** The point the delta is measured against, for "vs Sep". */
    against: string | null;
    values: readonly number[];
    labels: readonly string[];
    /** -1 when nothing is selected, as on "All time". */
    selected: number;
    onSelect: (index: number) => void;
};

export function StatsChart({
    metric,
    value,
    name,
    delta,
    against,
    values,
    labels,
    selected,
    onSelect,
}: StatsChartProps) {
    const t = useT();
    const rtl = useIsRTL();
    const locale = useLocale();
    const skin = SKIN[metric];
    const [width, setWidth] = useState(0);

    const points = chartPoints(values, { width, height: HEIGHT, pad: PAD, top: TOP, bottom: BOTTOM });
    const drawX = (x: number) => (rtl ? width - x : x);
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${drawX(p.x)},${p.y}`).join(' ');
    const first = points[0];
    const last = points[points.length - 1];
    const area =
        first && last && points.length > 1
            ? `${line} L${drawX(last.x)},${HEIGHT - AXIS} L${drawX(first.x)},${HEIGHT - AXIS} Z`
            : '';
    const focus = selected >= 0 ? points[selected] : undefined;

    const figure = (amount: number, compact = false) =>
        isMoney(metric) ? formatEgp(amount, { compact, showCurrency: false }) : String(amount);

    return (
        <View style={[styles.card, { experimental_backgroundImage: skin.glow }]} testID="stats-chart">
            <View style={styles.head}>
                <View style={styles.titles}>
                    <Text variant="eyebrow" script="sans" weight="bold" tone="inverse" style={styles.dim}>
                        {`${t(METRIC_LABEL[metric])} · ${name}`}
                    </Text>
                    <View style={styles.figure}>
                        <Text variant="display" weight="semibold" tone="inverse" testID="stats-chart-value">
                            {figure(value)}
                        </Text>
                        {isMoney(metric) ? (
                            <Text variant="footnote" weight="semibold" tone="inverse" style={styles.unit}>
                                {currencyOf(locale)}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {delta && against ? (
                    <View style={[styles.delta, delta.good ? styles.deltaGood : styles.deltaBad]}>
                        <Text
                            variant="footnote"
                            weight="semibold"
                            tone={delta.good ? 'successOnDark' : 'dueOnDark'}
                            testID="stats-chart-delta"
                        >
                            {t('{arrow} {percent}% vs {point}', {
                                arrow: delta.up ? '▲' : '▼',
                                percent: delta.percent,
                                point: against,
                            })}
                        </Text>
                    </View>
                ) : null}
            </View>

            <View
                style={styles.plot}
                onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
            >
                {width > 0 ? (
                    <Svg width={width} height={HEIGHT} style={styles.svg}>
                        {area ? <Path d={area} fill={skin.onDark} fillOpacity={skin.fillOpacity} /> : null}
                        {points.length > 1 ? (
                            <Path
                                d={line}
                                fill="none"
                                stroke={skin.onDark}
                                strokeWidth={2.5}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        ) : null}
                        {focus ? (
                            <Line
                                x1={drawX(focus.x)}
                                y1={focus.y}
                                x2={drawX(focus.x)}
                                y2={HEIGHT - AXIS}
                                stroke={color.onDarkGuide}
                                strokeWidth={1.5}
                                strokeDasharray="4 4"
                            />
                        ) : null}
                        {points.map((p, i) =>
                            i === selected ? null : (
                                <Circle
                                    // biome-ignore lint/suspicious/noArrayIndexKey: a point is its position
                                    key={i}
                                    cx={drawX(p.x)}
                                    cy={p.y}
                                    r={3}
                                    fill={color.inverse}
                                    fillOpacity={0.7}
                                />
                            ),
                        )}
                        {focus ? (
                            <>
                                <Circle
                                    cx={drawX(focus.x)}
                                    cy={focus.y}
                                    r={8}
                                    fill={color.inkDeep}
                                    stroke={skin.onDark}
                                    strokeWidth={1.5}
                                />
                                <Circle cx={drawX(focus.x)} cy={focus.y} r={5} fill={skin.onDark} />
                            </>
                        ) : null}
                    </Svg>
                ) : null}

                {focus ? (
                    <View
                        style={[
                            styles.tag,
                            { start: clamp(focus.x - TAG / 2, 0, width - TAG), top: focus.y - 30 },
                        ]}
                        pointerEvents="none"
                    >
                        <Text variant="footnote" weight="semibold" tone={skin.onDarkTone} numberOfLines={1}>
                            {figure(values[selected] ?? 0)}
                        </Text>
                    </View>
                ) : null}

                {points.map((p, i) => (
                    <Pressable
                        // biome-ignore lint/suspicious/noArrayIndexKey: a point is its position
                        key={i}
                        accessibilityRole="button"
                        accessibilityState={{ selected: i === selected }}
                        accessibilityLabel={`${labels[i] ?? ''}, ${figure(values[i] ?? 0)}`}
                        onPress={() => onSelect(i)}
                        style={[styles.hit, { start: p.x - HIT / 2, top: p.y - HIT / 2 }]}
                        testID={`stats-point-${i}`}
                    />
                ))}

                {points.map((p, i) => (
                    <View
                        // biome-ignore lint/suspicious/noArrayIndexKey: a point is its position
                        key={i}
                        style={[
                            styles.axis,
                            {
                                start: p.x - axisWidth(points.length, width) / 2,
                                width: axisWidth(points.length, width),
                            },
                        ]}
                        pointerEvents="none"
                    >
                        <Text
                            variant="caption"
                            weight={i === selected ? 'semibold' : 'medium'}
                            tone="inverse"
                            style={i === selected ? null : styles.axisDim}
                            numberOfLines={1}
                        >
                            {labels[i]}
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** As wide as the gap between two points allows, so eight weeks of "26 Sep" do not run into each other. */
function axisWidth(count: number, width: number): number {
    if (count < 2) return 64;
    return Math.min(64, (width - 2 * PAD) / (count - 1));
}

const styles = StyleSheet.create({
    card: {
        gap: space[2],
        paddingTop: space[5],
        paddingHorizontal: space[4],
        paddingBottom: space[2.5],
        borderRadius: radius.xl4,
        backgroundColor: color.inkDeep,
        boxShadow: shadow.hero,
    },
    head: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: space[2],
        paddingHorizontal: space[1.5],
    },
    titles: { flexShrink: 1, gap: space[1], alignItems: 'flex-start' },
    dim: { opacity: 0.55 },
    figure: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
    unit: { opacity: 0.6 },
    delta: { paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.full },
    deltaGood: { backgroundColor: color.successOnDarkSoft },
    deltaBad: { backgroundColor: color.dueOnDarkSoft },
    plot: { height: HEIGHT },
    svg: { position: 'absolute', top: 0, start: 0 },
    tag: { position: 'absolute', width: TAG, alignItems: 'center' },
    hit: { position: 'absolute', width: HIT, height: HIT },
    axis: { position: 'absolute', top: HEIGHT - 16, alignItems: 'center' },
    axisDim: { opacity: 0.5 },
});
