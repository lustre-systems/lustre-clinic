/**
 * Month grid columns shared by CalendarSheet and MonthGrid. Each week is its
 * own unwrapped row of seven `flex: 1` columns, as is the weekday header: a
 * single wrapping row of `100/7%` cells could round past the row width and
 * push the seventh day onto the next line, shifting every day after it. A
 * column clips at `minWidth: 0` so no content can widen it, and the last week
 * is padded with blanks so its days do not stretch.
 */ import type { ReactNode } from 'react';
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
    /** Any day in the month on show. */
    month: string;
    /** Height of one week; the cell a day draws fills its column. */
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
