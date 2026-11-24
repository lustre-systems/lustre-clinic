import type { Tooth } from '@lustre/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { border, color, radius, space, Text } from '../../theme';
import { Chevron } from '../ui';

export type ToothGroupLine = {
    id: string;
    name: string;
    detail?: string | null;
    money?: ReactNode;
    trailing?: ReactNode;
};

export type ToothGroupCardProps = {
    tooth: Tooth | null;
    position: string;
    lines: readonly ToothGroupLine[];
    variant?: 'card' | 'row';
    subtotal?: ReactNode;
    expanded?: boolean;
    onToggle?: () => void;
    footer?: ReactNode;
    testID?: string;
};

export function ToothGroupCard({
    tooth,
    position,
    lines,
    variant = 'card',
    subtotal,
    expanded = true,
    onToggle,
    footer,
    testID,
}: ToothGroupCardProps) {
    const t = useT();
    if (variant === 'row') {
        return (
            <View style={styles.row} testID={testID}>
                <ToothBadge tooth={tooth} variant="row" />
                <View style={styles.rowBody}>
                    {lines.map((line) => (
                        <Line key={line.id} line={line} stacked />
                    ))}
                    {position ? (
                        <Text variant="footnote" tone="muted">
                            {position}
                        </Text>
                    ) : null}
                </View>
            </View>
        );
    }

    const head = (
        <>
            <ToothBadge tooth={tooth} variant="card" />
            <Text variant="subhead" tone="muted" numberOfLines={1} style={styles.grow}>
                {position}
            </Text>
            {subtotal}
            {onToggle ? <Chevron direction={expanded ? 'up' : 'down'} size={9} /> : null}
        </>
    );

    return (
        <View style={styles.card} testID={testID}>
            {onToggle ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={
                        position
                            ? t('{position}, {count} procedures', { position, count: lines.length })
                            : t('{count} procedures', { count: lines.length })
                    }
                    onPress={onToggle}
                    style={({ pressed }) => [styles.head, pressed && styles.pressed]}
                >
                    {head}
                </Pressable>
            ) : (
                <View style={styles.head}>{head}</View>
            )}

            {expanded ? (
                <View>
                    {lines.map((line) => (
                        <Line key={line.id} line={line} />
                    ))}
                    {footer}
                </View>
            ) : null}
        </View>
    );
}

function ToothBadge({ tooth, variant }: { tooth: Tooth | null; variant: 'card' | 'row' }) {
    return (
        <View
            style={[
                styles.badge,
                variant === 'card' ? styles.badgeCard : styles.badgeRow,
                !tooth && styles.badgeNone,
            ]}
        >
            <Text variant="footnote" script="sans" weight="bold" tone={tooth ? 'ink' : 'muted'}>
                {tooth ?? '—'}
            </Text>
        </View>
    );
}

function Line({ line, stacked = false }: { line: ToothGroupLine; stacked?: boolean }) {
    return (
        <View style={stacked ? styles.stackedLine : styles.line}>
            <View style={styles.grow}>
                <Text variant="body" weight="semibold" numberOfLines={stacked ? undefined : 1}>
                    {line.name}
                </Text>
                {line.detail ? (
                    <Text variant="caption" tone="muted">
                        {line.detail}
                    </Text>
                ) : null}
            </View>
            {line.money}
            {line.trailing}
        </View>
    );
}

const styles = StyleSheet.create({
    grow: { flex: 1, minWidth: 0 },

    card: {
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
        overflow: 'hidden',
    },
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: 54,
        paddingHorizontal: space[3],
    },
    pressed: { opacity: 0.72 },

    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
    },
    rowBody: { flex: 1, gap: space[0.5], paddingTop: space[0.5] },

    badge: {
        minWidth: 46,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[1.5],
        borderWidth: border.hair,
        borderColor: color.line,
    },
    badgeCard: { height: 37, borderRadius: radius.md, backgroundColor: color.surface },
    badgeRow: { height: 32, borderRadius: radius.sm, backgroundColor: color.surface2 },
    badgeNone: { backgroundColor: color.surface, borderStyle: 'dashed' },

    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingStart: space[3.5],
        paddingEnd: space[2.5],
        paddingVertical: space[2],
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
    },
    stackedLine: { gap: space[0.5] },
});
