import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import type { TextTone } from '../../theme';
import { border, color, radius, shadow, size, space, Text } from '../../theme';
import { usePressLock } from './usePressLock';

export type ButtonVariant =
    | 'primary'
    | 'accent'
    | 'accentSoft'
    | 'inverse'
    | 'secondary'
    | 'ghost'
    | 'text'
    | 'danger'
    | 'dangerText'
    | 'whatsapp';
export type ButtonSize = 'lg' | 'md';

export type ButtonProps = {
    label: string;
    onPress?: () => void;
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    disabled?: boolean;
    icon?: ReactNode;
    block?: boolean;
    pressLockMs?: number;
    style?: StyleProp<ViewStyle>;
    testID?: string;
};

const LABEL_TONE: Record<ButtonVariant, TextTone> = {
    primary: 'inverse',
    accent: 'inverse',
    accentSoft: 'accent',
    inverse: 'ink',
    secondary: 'ink',
    ghost: 'ink',
    text: 'accent',
    danger: 'danger',
    dangerText: 'danger',
    whatsapp: 'inverse',
};

const SPINNER: Record<ButtonVariant, string> = {
    primary: color.inverse,
    accent: color.inverse,
    accentSoft: color.accent,
    inverse: color.ink,
    secondary: color.ink,
    ghost: color.ink,
    text: color.accent,
    danger: color.danger,
    dangerText: color.danger,
    whatsapp: color.inverse,
};

type DisabledLook = 'disabledFilled' | 'disabledOutlined' | 'disabledBare';

const DISABLED: Record<ButtonVariant, DisabledLook> = {
    primary: 'disabledFilled',
    accent: 'disabledFilled',
    accentSoft: 'disabledFilled',
    inverse: 'disabledFilled',
    secondary: 'disabledOutlined',
    ghost: 'disabledOutlined',
    text: 'disabledBare',
    danger: 'disabledOutlined',
    dangerText: 'disabledBare',
    whatsapp: 'disabledFilled',
};

export function Button({
    label,
    onPress,
    variant = 'primary',
    size: sizeProp = 'lg',
    loading = false,
    disabled = false,
    icon,
    block = false,
    pressLockMs = 500,
    style,
    testID,
}: ButtonProps) {
    const t = useT();
    const shownLabel = t(label);
    const lock = usePressLock(pressLockMs);
    const inert = disabled || loading;
    const dimmed = disabled;

    function handlePress() {
        if (inert || !onPress) return;
        lock(() => {
            Keyboard.dismiss();
            onPress();
        });
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={shownLabel}
            accessibilityState={{ disabled: inert, busy: loading }}
            disabled={inert}
            onPress={handlePress}
            testID={testID}
            style={({ pressed }) => [
                styles.base,
                sizeProp === 'lg' ? styles.lg : styles.md,
                styles[variant],
                block && styles.block,
                pressed && styles.pressed,
                dimmed && styles[DISABLED[variant]],
                style,
            ]}
        >
            <View style={[styles.content, loading && styles.hidden]}>
                {icon}
                <Text
                    variant={sizeProp === 'lg' ? 'headline' : 'callout'}
                    weight="semibold"
                    tone={dimmed ? 'muted' : LABEL_TONE[variant]}
                    numberOfLines={1}
                >
                    {shownLabel}
                </Text>
            </View>

            {loading && (
                <View style={styles.spinner} pointerEvents="none">
                    <ActivityIndicator size="small" color={dimmed ? color.muted : SPINNER[variant]} />
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    base: {
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: space[5],
    },
    lg: { minHeight: size.button, borderRadius: radius.full },
    md: { minHeight: size.row, borderRadius: radius.lg, paddingHorizontal: space[4] },
    block: { alignSelf: 'stretch' },

    primary: { backgroundColor: color.ink },
    accent: { backgroundColor: color.accent },
    accentSoft: { backgroundColor: color.accentSoft },
    inverse: { backgroundColor: color.surface },
    secondary: { borderWidth: border.thick, borderColor: color.outline },
    ghost: {
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
        boxShadow: shadow.pill,
    },
    text: { paddingHorizontal: space[2], minHeight: size.row },
    danger: { borderWidth: border.thick, borderColor: color.danger, backgroundColor: color.surface },
    dangerText: { paddingHorizontal: space[2], minHeight: size.row },
    whatsapp: { backgroundColor: color.wa },

    content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    hidden: { opacity: 0 },
    spinner: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },

    pressed: { opacity: 0.72 },

    disabledFilled: { backgroundColor: color.surface2 },
    disabledOutlined: { backgroundColor: color.surface2, borderColor: color.line },
    disabledBare: { backgroundColor: color.transparent },
});
