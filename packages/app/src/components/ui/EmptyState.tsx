import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, shadow, space, Text } from '../../theme';
import { Button } from './Button';

export type EmptyStateProps = {
    title: string;
    body?: string;
    icon?: ReactNode;
    actionLabel?: string;
    onAction?: () => void;
    weight?: 'ring' | 'panel' | 'line';
};

export function EmptyState({ title, body, icon, actionLabel, onAction, weight = 'ring' }: EmptyStateProps) {
    const t = useT();
    if (weight === 'line') {
        return (
            <View style={styles.line}>
                <Text variant="subhead" tone="muted">
                    {t(title)}
                </Text>
            </View>
        );
    }

    const panel = weight === 'panel';
    const pressable = Boolean(actionLabel && onAction);

    return (
        <View style={[styles.state, panel && styles.panel]}>
            {icon == null ? null : pressable ? (
                <Pressable
                    onPress={onAction}
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    style={({ pressed }) => [styles.glyph, styles.ring, pressed && styles.pressed]}
                >
                    {icon}
                </Pressable>
            ) : (
                <View style={[styles.glyph, styles.tile]}>{icon}</View>
            )}

            <Text variant="headline">{t(title)}</Text>
            {body ? (
                <Text variant="subhead" tone="muted" style={styles.body}>
                    {t(body)}
                </Text>
            ) : null}

            {actionLabel ? (
                <Button
                    label={actionLabel}
                    onPress={onAction}
                    variant={panel ? 'primary' : 'ghost'}
                    size={panel ? 'lg' : 'md'}
                    block={panel}
                    style={panel ? undefined : styles.action}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    state: { alignSelf: 'stretch', alignItems: 'center', gap: space[2], paddingVertical: space[8] },
    panel: {
        paddingVertical: space[6],
        paddingHorizontal: space[5],
        borderRadius: radius.xl2,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.canvas,
    },
    glyph: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
    ring: {
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
        boxShadow: shadow.pill,
    },
    tile: { borderRadius: radius.xl, backgroundColor: color.surface2 },
    pressed: { opacity: 0.72 },
    body: { textAlign: 'center' },
    action: { alignSelf: 'center', marginTop: space[2] },
    line: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: space[6] },
});
