/**
 * A month of days that have already happened, one of them picked: the record's
 * Old visit page asks its "which day" with it inline, the way booking asks
 * "when" on its own step, rather than behind a sheet on top of a page.
 *
 * Days after today are not offered, and paging forward stops at this month:
 * an old visit is something that has happened. It fetches nothing —
 * nothing was booked on these days that the answer depends on — and holds no
 * state; the month on show and the pick are the caller's.
 */
import { keyParts, todayKey } from '@lustre/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { Chevron, IconButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { WeekdayHeader, WeekRows } from '../../day/components/WeekRows';
import { addMonths, formatLongDate, formatMonth } from '../../day/time';

export type MonthGridProps = {
    /** Any day in the month on show. */
    month: string;
    onMonth: (month: string) => void;
    selected: string | null;
    onPick: (day: string) => void;
};

export function MonthGrid({ month, onMonth, selected, onPick }: MonthGridProps) {
    const t = useT();
    const today = todayKey();

    function goToMonth(next: string) {
        // Paging forward stops at the month today is in — there is nothing to
        // pick beyond it, and an empty grid of disabled cells reads as broken.
        onMonth(next > today ? monthOf(today) : next);
    }

    return (
        <View>
            <View style={styles.monthBar}>
                <Text variant="title3" weight="semibold">
                    {formatMonth(month)}
                </Text>
                {/* `pressLockMs={0}`: paging back through years is many
                    deliberate taps, and the default lock eats half of them. */}
                <View style={styles.monthNav}>
                    <IconButton
                        accessibilityLabel={t('Previous year')}
                        icon={<DoubleChevron direction="back" />}
                        variant="square"
                        pressLockMs={0}
                        onPress={() => goToMonth(addMonths(month, -12))}
                    />
                    <IconButton
                        accessibilityLabel={t('Previous month')}
                        icon={<Chevron direction="back" tone="ink" size={9} />}
                        variant="square"
                        pressLockMs={0}
                        onPress={() => goToMonth(addMonths(month, -1))}
                    />
                    <IconButton
                        accessibilityLabel={t('Next month')}
                        icon={<Chevron direction="forward" tone="ink" size={9} />}
                        variant="square"
                        pressLockMs={0}
                        onPress={() => goToMonth(addMonths(month, 1))}
                    />
                    <IconButton
                        accessibilityLabel={t('Next year')}
                        icon={<DoubleChevron direction="forward" />}
                        variant="square"
                        pressLockMs={0}
                        onPress={() => goToMonth(addMonths(month, 12))}
                    />
                </View>
            </View>

            <WeekdayHeader />

            <WeekRows
                month={month}
                rowHeight={CELL}
                renderDay={(day) => {
                    const ahead = day > today;
                    const picked = day === selected;

                    return (
                        <Pressable
                            key={day}
                            disabled={ahead}
                            accessibilityRole="button"
                            accessibilityState={{ selected: picked, disabled: ahead }}
                            accessibilityLabel={formatLongDate(day)}
                            onPress={() => onPick(day)}
                            style={styles.cell}
                        >
                            {/* The fill is a child of a clipped box rather than a
                                background on the pressable: Android drops the
                                corner radius when it paints a descendant's
                                background, and the clip is what does hold.
                                `day/CalendarSheet` carries the same note. */}
                            <View style={styles.cellBox}>
                                {picked ? <View style={styles.fill} /> : null}
                                {!picked && day === today ? (
                                    <View pointerEvents="none" style={styles.todayRing} />
                                ) : null}

                                <Text
                                    variant="callout"
                                    // Instrument Sans, not the cluster's mono:
                                    // DM Mono stops at 500 and a grid is read at
                                    // a glance, so it wants 700.
                                    script="sans"
                                    weight="bold"
                                    tone={picked ? 'inverse' : ahead ? 'muted' : 'ink'}
                                >
                                    {keyParts(day).day}
                                </Text>
                            </View>
                        </Pressable>
                    );
                }}
            />
        </View>
    );
}

/** The first of the month a day falls in — what the pager clamps to. */
function monthOf(key: string): string {
    return `${key.slice(0, 7)}-01`;
}

function DoubleChevron({ direction }: { direction: 'back' | 'forward' }) {
    return (
        // The overlap is on the second glyph, not the pair: pulling the whole
        // row in by a margin set it off the button's centre.
        <View style={styles.doubleChevron}>
            <Chevron direction={direction} tone="ink" size={9} />
            <View style={styles.overlap}>
                <Chevron direction={direction} tone="ink" size={9} />
            </View>
        </View>
    );
}

const CELL = size.row;

const styles = StyleSheet.create({
    monthBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[2],
        marginBottom: space[3],
    },
    monthNav: { flexDirection: 'row', gap: space[1.5] },
    doubleChevron: { flexDirection: 'row', alignItems: 'center' },
    overlap: { marginStart: -3 },

    cell: { flex: 1, padding: space[0.5] },
    cellBox: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        overflow: 'hidden',
    },
    fill: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: color.ink },
    todayRing: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        borderWidth: border.thick,
        borderColor: color.ink,
        borderRadius: radius.md,
    },
});
