import { StyleSheet, View } from 'react-native';
import { border, color, radius, size, space } from '../../theme';
import { Card, CardDivider } from './Card';

export type SkeletonRowsProps = {
    count?: number;
    trailing?: boolean;
    ruled?: boolean;
    gutter?: number;
};

export function SkeletonRows({
    count = 3,
    trailing = false,
    ruled = false,
    gutter = space[4],
}: SkeletonRowsProps) {
    const keys = Array.from({ length: Math.max(0, count) }, (_, index) => `skeleton-${index}`);

    const rows = keys.map((key, index) => (
        <View key={key} style={ruled ? styles.ruled : undefined}>
            {!ruled && index > 0 ? <CardDivider /> : null}
            <View style={[styles.row, { paddingHorizontal: gutter }]}>
                <View style={styles.lines}>
                    <View style={[styles.bar, styles.primary, ruled && index % 2 === 0 && styles.wide]} />
                    <View style={[styles.bar, styles.secondary]} />
                </View>
                {trailing ? <View style={[styles.bar, styles.value]} /> : null}
            </View>
        </View>
    ));

    if (ruled) {
        return (
            <View accessibilityLabel="Loading" accessibilityRole="progressbar">
                {rows}
            </View>
        );
    }

    return (
        <Card accessibilityLabel="Loading" accessibilityRole="progressbar">
            {rows}
        </Card>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[3],
    },
    ruled: {
        backgroundColor: color.canvas,
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
    },
    lines: { flex: 1, gap: space[1.5] },
    bar: { height: 10, borderRadius: radius.sm, backgroundColor: color.surface2 },
    primary: { width: '52%' },
    wide: { width: '68%' },
    secondary: { width: '34%', height: 8 },
    value: { width: 64 },
});
