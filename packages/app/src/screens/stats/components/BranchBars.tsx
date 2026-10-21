// Profit per chart point, stacked by branch: the biggest earner at the bottom
// in `ink`, the next in `inkFaint` above it. The selected bar is full strength
// with its total on top and the rest fade back; tapping a bar selects that
// point everywhere, like tapping it on the chart. A branch that lost money in a
// period has no height to stack, so it draws nothing rather than a bar going
// down through the others; the total on top is still the honest figure.
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../../i18n';
import { color, radius, space, Text } from '../../../theme';
import type { StatsFigures } from '../data';
import { formatEgp } from '../money';
import { branchOrder, leadingShare } from '../stats';

const BAR_HEIGHT = 110;
const MIN_SEGMENT = 4;
/** The design's column (six months on a 390-wide phone), as a ceiling: four weeks must not draw four slabs. */
const BAR_MAX_WIDTH = 40;
const SHADES = [color.ink, color.inkFaint, color.muted, color.line] as const;

export type BranchBarsProps = {
    points: readonly StatsFigures[];
    labels: readonly string[];
    /** Each point's full name, for the sentence under the bars: "September", "Week of 4 Oct". */
    names: readonly string[];
    /** The whole period, for the sentence under the bars while no bar is selected. */
    total: StatsFigures | undefined;
    /** The pill's name, for that sentence. */
    periodName: string;
    /** Where a second tap on the selected bar goes back to, or null when it is already there. */
    back: string | null;
    /** -1 when nothing is selected. */
    selected: number;
    onSelect: (index: number) => void;
};

export function BranchBars({
    points,
    labels,
    names,
    total,
    periodName,
    back,
    selected,
    onSelect,
}: BranchBarsProps) {
    const t = useT();
    const branches = branchOrder(points);
    const shade = (index: number) => SHADES[Math.min(index, SHADES.length - 1)];

    const heights = points.map((point) =>
        branches.map(({ branchId }) =>
            Math.max(0, point.branches.find((row) => row.branchId === branchId)?.profit ?? 0),
        ),
    );
    const tallest = Math.max(1, ...heights.map((stack) => stack.reduce((sum, v) => sum + v, 0)));
    const labelled = selected >= 0 ? selected : points.length - 1;

    const focus = selected >= 0 ? points[selected] : total;
    const share = focus ? leadingShare(focus) : null;
    const shareOf = selected >= 0 ? (names[selected] ?? '') : periodName;

    return (
        <View style={styles.card} testID="stats-branches">
            <View style={styles.head}>
                <Text variant="body" weight="semibold">
                    {t('Branches')}
                </Text>
                <View style={styles.legend}>
                    {branches.map((branch, index) => (
                        <View key={branch.branchId} style={styles.legendItem}>
                            <View style={[styles.dot, { backgroundColor: shade(index) }]} />
                            <Text variant="footnote" tone="muted" numberOfLines={1}>
                                {branch.name}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
            <Text variant="footnote" tone="muted" style={styles.subtitle}>
                {t('Profit, stacked by branch')}
            </Text>

            <View style={[styles.bars, { gap: points.length > 6 ? space[1.5] : space[2.5] }]}>
                {points.map((point, i) => {
                    const on = i === selected;
                    const stack = heights[i] ?? [];
                    return (
                        <Pressable
                            // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its position
                            key={i}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={`${labels[i] ?? ''}, ${formatEgp(point.profit)}`}
                            onPress={() => onSelect(i)}
                            style={({ pressed }) => [
                                styles.column,
                                selected >= 0 && !on && styles.faded,
                                pressed && styles.pressed,
                            ]}
                            testID={`stats-bar-${i}`}
                        >
                            <Text
                                variant="caption"
                                weight="bold"
                                tone="ink2"
                                numberOfLines={1}
                                style={i === labelled ? styles.total : styles.hidden}
                            >
                                {formatEgp(point.profit, { compact: true, showCurrency: false })}
                            </Text>
                            <View style={styles.stack}>
                                {/* Top of the stack first: the biggest earner sits at the bottom. */}
                                {[...stack.keys()].reverse().map((index) => {
                                    const value = stack[index] ?? 0;
                                    if (value <= 0) return null;
                                    return (
                                        <View
                                            key={branches[index]?.branchId ?? index}
                                            style={[
                                                styles.segment,
                                                {
                                                    height: Math.max(
                                                        MIN_SEGMENT,
                                                        (value / tallest) * BAR_HEIGHT,
                                                    ),
                                                    backgroundColor: shade(index),
                                                },
                                            ]}
                                        />
                                    );
                                })}
                            </View>
                            <Text
                                variant="caption"
                                weight={on ? 'bold' : 'medium'}
                                tone={on ? 'ink' : 'muted'}
                                numberOfLines={1}
                                style={styles.label}
                            >
                                {labels[i]}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <View style={styles.note}>
                {share ? (
                    <Text variant="subhead" tone="ink2">
                        {t('{point}: {branch} brought {percent}% of the profit.', {
                            point: shareOf,
                            branch: share.name,
                            percent: share.percent,
                        })}
                    </Text>
                ) : null}
                <Text variant="footnote" tone="muted">
                    {back
                        ? t('Tap the bar again to go back to {period}.', { period: back })
                        : t('Tap a bar to see its split.')}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        gap: space[3.5],
        padding: space[4.5],
        borderRadius: radius.xl3,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
    legend: { flexDirection: 'row', flexShrink: 1, gap: space[3] },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexShrink: 1 },
    dot: { width: 8, height: 8, borderRadius: radius.full },
    subtitle: { marginTop: -space[2.5] },
    // Room for the total over the tallest stack and the label under it, so no column overflows and pushes its label out of line.
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: BAR_HEIGHT + 54 },
    column: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: space[1.5] },
    faded: { opacity: 0.35 },
    pressed: { transform: [{ scale: 0.94 }] },
    total: { alignSelf: 'stretch', textAlign: 'center' },
    hidden: { alignSelf: 'stretch', textAlign: 'center', opacity: 0 },
    stack: { alignSelf: 'stretch', alignItems: 'center', gap: 2, paddingHorizontal: 3 },
    segment: { width: '100%', maxWidth: BAR_MAX_WIDTH, borderRadius: 6 },
    label: { alignSelf: 'stretch', textAlign: 'center' },
    note: {
        gap: space[1],
        paddingVertical: space[3],
        paddingHorizontal: space[3.5],
        borderRadius: radius.lg,
        backgroundColor: color.surface2,
    },
});
