// The black chart card at the top of the stats screen: the metric and what it
// covers in the header, with its figure and the change on what came before,
// then a line over the period and the ones before it. Tapping a point shows it;
// tapping it again goes back to the one the pill opened on.
//
// The line is drawn left to right in English and right to left in Arabic, the
// way the pills and the bars read. The SVG does not mirror by itself, so its
// x is flipped here; the overlays (the tap targets, the tag over the selected
// point and the axis labels) sit on `start`, which the layout mirrors for us.
//
// A new run of points — the screen coming up, or another pill's — draws itself in
// the reading direction, the area filling in behind it and each dot appearing
// as the line reaches it. The same points with new figures (another metric, a
// refresh) do not draw again: each point eases from where it was to where it is
// now, and the dot, its tag and the tap targets ride along.
// biome-ignore lint/style/noRestrictedImports: drives the line's draw and its morph with `Animated.timing` imperatively, and stops them on cleanup
import { useEffect, useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { duration, easing, useReducedMotion } from '../../../components/ui';
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
    /** Where a second tap on the selected point goes back to, or null when it is already there. */
    back: string | null;
    delta: Delta | null;
    /** What the delta is measured against, for "vs last month" or "vs Sep". */
    against: string | null;
    values: readonly number[];
    labels: readonly string[];
    /** -1 when nothing is selected, as on "All time". */
    selected: number;
    onSelect: (index: number) => void;
    /** Whether the screen is up. The line draws itself in each time it comes up, and waits while it is hidden. */
    onScreen?: boolean;
};

export function StatsChart({
    metric,
    value,
    name,
    back,
    delta,
    against,
    values,
    labels,
    selected,
    onSelect,
    onScreen = true,
}: StatsChartProps) {
    const t = useT();
    const rtl = useIsRTL();
    const locale = useLocale();
    const skin = SKIN[metric];
    const [width, setWidth] = useState(0);

    // The labels name the points, so new labels are a new line to draw; the
    // same labels with new values are the same line moving.
    const series = labels.join('|');
    const target = chartPoints(values, { width, height: HEIGHT, pad: PAD, top: TOP, bottom: BOTTOM });
    const heights = useEasedHeights(
        target.map((p) => p.y),
        series,
    );
    const points = target.map((p, i) => ({ x: p.x, y: heights[i] ?? p.y }));
    const drawn = useDrawn(width > 0 && onScreen ? series : null);
    const { path: reached, reaches } = along(points, drawn);
    const drawX = (x: number) => (rtl ? width - x : x);
    const line = reached.map((p, i) => `${i === 0 ? 'M' : 'L'}${drawX(p.x)},${p.y}`).join(' ');
    const first = reached[0];
    const last = reached[reached.length - 1];
    const area =
        first && last && reached.length > 1
            ? `${line} L${drawX(last.x)},${HEIGHT - AXIS} L${drawX(first.x)},${HEIGHT - AXIS} Z`
            : '';
    const focus = selected >= 0 && reaches(selected) ? points[selected] : undefined;
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
                    // No change is neither news nor a warning: no arrow, no colour.
                    <View
                        style={[
                            styles.delta,
                            delta.flat ? styles.deltaFlat : delta.good ? styles.deltaGood : styles.deltaBad,
                        ]}
                    >
                        <Text
                            variant="footnote"
                            weight="semibold"
                            tone={delta.flat ? 'inverse' : delta.good ? 'successOnDark' : 'dueOnDark'}
                            style={delta.flat ? styles.dim : null}
                            testID="stats-chart-delta"
                        >
                            {delta.flat
                                ? t('{percent}% vs {point}', { percent: delta.percent, point: against })
                                : t('{arrow} {percent}% vs {point}', {
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
                            i === selected || !reaches(i) ? null : (
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
                {back
                    ? t('Tap it again to go back to {period}', { period: back })
                    : t('Tap a point for a closer look')}
            </Text>
        </View>
    );
}

/**
 * Runs `frame` from 0 to 1 and calls it once more on 1 when it lands, so the
 * end state is applied even at duration 0. Returns the stop for cleanup.
 */
function tween(ms: number, curve: (t: number) => number, frame: (t: number) => void): () => void {
    const progress = new Animated.Value(0);
    const id = progress.addListener(({ value }) => frame(value));
    const timing = Animated.timing(progress, {
        toValue: 1,
        duration: ms,
        easing: curve,
        useNativeDriver: false,
    });

    timing.start(({ finished }) => {
        if (finished) frame(1);
    });
    return () => {
        timing.stop();
        progress.removeListener(id);
    };
}

/**
 * How much of the line is drawn, 0 to 1. Starts again from nothing whenever
 * `series` changes; null holds it at nothing, for a plot with no width yet or a screen that is hidden.
 */
function useDrawn(series: string | null): number {
    const reducedMotion = useReducedMotion();
    // Tagged with its series, so a new one reads as nothing drawn from its very
    // first render rather than flashing whole for a frame before the effect.
    const [state, setState] = useState({ series, drawn: 0 });

    useEffect(() => {
        // Hidden, it goes back to nothing drawn, so coming up draws it again.
        if (series === null) {
            setState({ series, drawn: 0 });
            return;
        }
        return tween(reducedMotion ? 0 : duration.draw, easing.sheet, (drawn) => setState({ series, drawn }));
    }, [series, reducedMotion]);

    return state.series === series ? state.drawn : 0;
}

/**
 * Where each point sits on its way to `to`. Interrupted, it eases on from
 * wherever the line had got to. A new `series` is a new line, which `useDrawn`
 * brings in, so its points start where they belong.
 */
function useEasedHeights(to: readonly number[], series: string): readonly number[] {
    const reducedMotion = useReducedMotion();
    const key = to.join(',');
    const [shown, setShown] = useState<readonly number[]>(to);
    // What is on screen right now, read when a new target interrupts the last.
    const live = useRef({ heights: shown, series });

    useEffect(() => {
        const target = key ? key.split(',').map(Number) : [];
        const from =
            live.current.series === series && live.current.heights.length === target.length
                ? live.current.heights
                : target;
        const show = (heights: readonly number[]) => {
            live.current = { heights, series };
            setShown(heights);
        };
        return tween(reducedMotion ? 0 : duration.promote, easing.promote, (t) =>
            show(target.map((y, i) => (from[i] ?? y) + (y - (from[i] ?? y)) * t)),
        );
    }, [key, series, reducedMotion]);

    // The render before the effect catches up with a new run of points.
    return shown.length === to.length && live.current.series === series ? shown : to;
}

type Point = { x: number; y: number };

/**
 * The first `fraction` of the line by length, cut mid-segment where it ends,
 * and whether it has reached a given point yet.
 */
function along(
    points: readonly Point[],
    fraction: number,
): { path: Point[]; reaches: (i: number) => boolean } {
    const at = [0];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1] as Point;
        const b = points[i] as Point;
        at.push((at[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const reach = (at[at.length - 1] ?? 0) * fraction;
    const reaches = (i: number) => fraction >= 1 || (at[i] ?? Number.POSITIVE_INFINITY) <= reach;

    const path: Point[] = [];
    for (let i = 0; i < points.length; i++) {
        const b = points[i] as Point;
        if (reaches(i)) {
            path.push(b);
            continue;
        }
        const a = points[i - 1];
        const start = at[i - 1] ?? 0;
        const span = (at[i] ?? start) - start;
        if (a && span > 0) {
            const t = (reach - start) / span;
            path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        break;
    }
    return { path, reaches };
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
    deltaFlat: { backgroundColor: color.onDarkTrack },
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
