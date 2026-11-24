import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import { PERIOD_LABEL, PERIODS, type Period } from '../money';

const PILL_HEIGHT = 40;

export type PeriodTabsProps = {
    value: Period;
    onChange: (period: Period) => void;
};

export function PeriodTabs({ value, onChange }: PeriodTabsProps) {
    const t = useT();
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.track}
            accessibilityRole="tablist"
        >
            {PERIODS.map((period) => {
                const selected = period === value;

                return (
                    <Pressable
                        key={period}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        onPress={() => onChange(period)}
                        style={({ pressed }) => [
                            styles.pill,
                            selected && styles.selected,
                            pressed && !selected && styles.pressed,
                        ]}
                        testID={`stats-period-${period}`}
                    >
                        <Text
                            variant="subhead"
                            weight="semibold"
                            tone={selected ? 'inverse' : 'muted'}
                            numberOfLines={1}
                        >
                            {t(PERIOD_LABEL[period])}
                        </Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    track: { gap: space[2], paddingHorizontal: size.gutter },
    pill: {
        justifyContent: 'center',
        minHeight: PILL_HEIGHT,
        paddingHorizontal: space[3.5],
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },
    selected: { backgroundColor: color.ink },
    pressed: { backgroundColor: color.canvas },
});
