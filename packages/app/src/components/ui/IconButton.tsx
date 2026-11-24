import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, space } from '../../theme';
import { usePressLock } from './usePressLock';

export type IconButtonVariant = 'circle' | 'filled' | 'square' | 'bare';
export type IconButtonTone = 'ink' | 'muted' | 'accent' | 'danger' | 'wa';

export type IconButtonProps = {
    accessibilityLabel: string;
    icon: ReactNode;
    onPress?: () => void;
    variant?: IconButtonVariant;
    tone?: IconButtonTone;
    disabled?: boolean;
    size?: number;
    pressLockMs?: number;
    style?: StyleProp<ViewStyle>;
    testID?: string;
};

const BOX: Record<IconButtonVariant, number> = {
    circle: 34,
    filled: 40,
    square: 32,
    bare: 30,
};

const FILL: Record<IconButtonTone, string> = {
    ink: color.ink,
    muted: color.surface2,
    accent: color.accent,
    danger: color.danger,
    wa: color.wa,
};

export function IconButton({
    accessibilityLabel,
    icon,
    onPress,
    variant = 'circle',
    tone = 'ink',
    disabled = false,
    size,
    pressLockMs = 500,
    style,
    testID,
}: IconButtonProps) {
    const t = useT();
    const box = size ?? BOX[variant];
    const lock = usePressLock(pressLockMs);

    function handlePress() {
        if (disabled || !onPress) return;
        lock(onPress);
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(accessibilityLabel)}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={handlePress}
            testID={testID}
            hitSlop={Math.max(0, Math.round((44 - box) / 2))}
            style={({ pressed }) => [
                styles.base,
                { width: box, height: box },
                variant === 'square' ? styles.square : styles.round,
                variant === 'circle' && styles.outlined,
                variant === 'filled' && { backgroundColor: FILL[tone] },
                variant === 'square' && styles.outlined,
                pressed && styles.pressed,
                disabled && styles.disabled,
                style,
            ]}
        >
            {icon}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    base: { alignItems: 'center', justifyContent: 'center', padding: space[0.5] },
    round: { borderRadius: radius.full },
    square: { borderRadius: radius.sm },
    outlined: { borderWidth: 1, borderColor: color.line, backgroundColor: color.surface },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.32 },
});
