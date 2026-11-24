import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { space, Text } from '../../../theme';
import { monthDays, weekdayOf } from '../time';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function WeekdayHeader() {
    return (
        <View style={styles.row}>
            {WEEKDAY_INITIALS.map((initial, index) => (
                <Text
                    // biome-ignore lint/suspicious/noArrayIndexKey: two Ts and two Ss
                    key={index}
                    variant="caption"
                    script="sans"
                    weight="bold"
                    tone="muted"
                    numberOfLines={1}
                    style={[styles.column, styles.weekday]}
                >
                    {initial}
                </Text>
            ))}
        </View>
    );
}

export type WeekRowsProps = {
    month: string;
    rowHeight: number;
    renderDay: (day: string) => ReactNode;
};

export function WeekRows({ month, rowHeight, renderDay }: WeekRowsProps) {
    const days = monthDays(month);
    const leading = weekdayOf(days[0] ?? month);
    const cells: (string | null)[] = [...Array<null>(leading).fill(null), ...days];
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (string | null)[][] = [];
    for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));

    return (
        <View style={styles.weeks}>
            {weeks.map((week) => (
                <View key={week.find(Boolean) ?? month} style={[styles.row, { height: rowHeight }]}>
                    {week.map((day, index) => (
                        <View key={day ?? `blank-${index}`} style={styles.column}>
                            {day ? renderDay(day) : null}
                        </View>
                    ))}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    weeks: { marginTop: space[1] },
    row: { flexDirection: 'row' },
    column: { flex: 1, minWidth: 0, overflow: 'hidden' },
    weekday: { textAlign: 'center' },
});
