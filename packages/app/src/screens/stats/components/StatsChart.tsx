// The black chart card at the top of the stats screen: the metric and what it
// covers in the header, with its figure and the change on what came before,
// then a line over the points inside the period. Tapping a point narrows the
// screen to it; tapping it again goes back to the whole period.
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

const HEIGHT = 150;
const PAD = 18;
const TOP = 34;
const BOTTOM = 30;
const AXIS = 22;
const HIT = 44;
const TAG = 84;
const TAG_HEIGHT = 22;
const TAG_GAP = 10;
/** The most axis labels that fit; past it the axis names every second or third point. */
const LABELS = 7;

export type StatsChartProps = {
    metric: Metric;
    /** The header's figure: the selected point's, or the whole period's when nothing is selected. */
    value: number;
    /** What the figure is of, after the metric: "This month", or the selected point. */
    name: string;
    /** The pill's own name, for the way back from a selected point. */
    period: string;
    delta: Delta | null;
    /** What the delta is measured against, for "vs last month" or "vs Sep". */
    against: string | null;
    values: readonly number[];
    labels: readonly string[];
    /** -1 when the whole period is showing. */
    selected: number;
    onSelect: (index: number) => void;
};

export function StatsChart({
    metric,
    value,
    name,
    period,
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
    const every = Math.ceil(points.length / LABELS);
    const axis = Math.min(64, points.length > 1 ? ((width - 2 * PAD) / (points.length - 1)) * every : 64);

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
                                // Ringed, so each point reads as something to tap
                                // rather than a vertex of the line.
                                <Circle
                                    // biome-ignore lint/suspicious/noArrayIndexKey: a point is its position
                                    key={i}
                                    cx={drawX(p.x)}
                                    cy={p.y}
                                    r={4.5}
                                    fill={color.inkDeep}
                                    stroke={skin.onDark}
                                    strokeWidth={2}
                                />
                            ),
                        )}
                        {focus ? (
                            <>
                                <Circle
                                    cx={drawX(focus.x)}
                                    cy={focus.y}
                                    r={10}
                                    fill={color.inkDeep}
                                    stroke={skin.onDark}
                                    strokeWidth={1.5}
                                />
                                <Circle cx={drawX(focus.x)} cy={focus.y} r={6} fill={skin.onDark} />
                            </>
                        ) : null}
                    </Svg>
                ) : null}

                {focus ? (
                    // On its own ground, so the line it sits over cannot run
                    // through the figure, and below the dot when there is no
                    // room above it.
                    <View
                        style={[
                            styles.tag,
                            {
                                start: clamp(focus.x - TAG / 2, 0, width - TAG),
                                top:
                                    focus.y - TAG_GAP - TAG_HEIGHT >= 0
                                        ? focus.y - TAG_GAP - TAG_HEIGHT
                                        : focus.y + TAG_GAP,
                            },
                        ]}
                        pointerEvents="none"
                    >
                        <Text variant="footnote" weight="bold" tone={skin.onDarkTone} numberOfLines={1}>
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

                {points.map((p, i) =>
                    i === selected ||
                    (i % every === 0 && selected < 0) ||
                    (i % every === 0 && Math.abs(i - selected) >= every) ? (
                        <View
                            // biome-ignore lint/suspicious/noArrayIndexKey: a point is its position
                            key={i}
                            style={[styles.axis, { start: p.x - axis / 2, width: axis }]}
                            pointerEvents="none"
                        >
                            <Text
                                variant="caption"
                                weight={i === selected ? 'bold' : 'medium'}
                                tone="inverse"
                                style={i === selected ? null : styles.axisDim}
                                numberOfLines={1}
                            >
                                {labels[i]}
                            </Text>
                        </View>
                    ) : null,
                )}
            </View>

            <Text variant="footnote" tone="inverse" style={styles.hint}>
                {selected >= 0
                    ? t('Tap it again for all of {period}', { period })
                    : t('Tap a point for a closer look')}
            </Text>
        </View>
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
    card: {
        gap: space[2],
        paddingTop: space[5],
        paddingHorizontal: space[4],
        paddingBottom: space[3],
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
    tag: {
        position: 'absolute',
        width: TAG,
        height: TAG_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.inkDeep,
        borderWidth: 1,
        borderColor: color.onDarkLine,
    },
    hit: { position: 'absolute', width: HIT, height: HIT },
    axis: { position: 'absolute', top: HEIGHT - 16, alignItems: 'center' },
    axisDim: { opacity: 0.5 },
    hint: { opacity: 0.45, textAlign: 'center' },
});
