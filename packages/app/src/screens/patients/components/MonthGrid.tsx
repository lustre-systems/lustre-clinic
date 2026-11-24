import { keyParts, todayKey } from '@lustre/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { Chevron, IconButton } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { WeekdayHeader, WeekRows } from '../../day/components/WeekRows';
import { addMonths, formatLongDate, formatMonth } from '../../day/time';

export type MonthGridProps = {
    month: string;
    onMonth: (month: string) => void;
    selected: string | null;
    onPick: (day: string) => void;
};

export function MonthGrid({ month, onMonth, selected, onPick }: MonthGridProps) {
    const t = useT();
    const today = todayKey();

    function goToMonth(next: string) {
        onMonth(next > today ? monthOf(today) : next);
    }

    return (
        <View>
            <View style={styles.monthBar}>
                <Text variant="title3" weight="semibold">
                    {formatMonth(month)}
                </Text>
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
                            <View style={styles.cellBox}>
                                {picked ? <View style={styles.fill} /> : null}
                                {!picked && day === today ? (
                                    <View pointerEvents="none" style={styles.todayRing} />
                                ) : null}

                                <Text
                                    variant="callout"
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

function monthOf(key: string): string {
    return `${key.slice(0, 7)}-01`;
}

function DoubleChevron({ direction }: { direction: 'back' | 'forward' }) {
    return (
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
