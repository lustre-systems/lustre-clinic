import { Pressable, StyleSheet } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, size, space, Text } from '../../theme';
import { usePressLock } from './usePressLock';

export type AddButtonVariant = 'full' | 'row' | 'footer' | 'compact';

export type AddButtonProps = {
    label: string;
    onPress?: () => void;
    variant?: AddButtonVariant;
    disabled?: boolean;
    pressLockMs?: number;
    testID?: string;
};

export function AddButton({
    label,
    onPress,
    variant = 'full',
    disabled = false,
    pressLockMs = 500,
    testID,
}: AddButtonProps) {
    const t = useT();
    const shown = t(label);
    const compact = variant === 'compact';
    const lock = usePressLock(pressLockMs);

    function handlePress() {
        if (disabled || !onPress) return;
        lock(onPress);
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={handlePress}
            testID={testID}
            style={({ pressed }) => [
                styles.base,
                variant === 'full' && styles.full,
                variant === 'row' && styles.row,
                variant === 'footer' && styles.footer,
                compact && styles.compact,
                pressed && styles.pressed,
                disabled && styles.disabled,
            ]}
        >
            <Text variant="callout" weight="medium" tone={compact ? 'inverse' : 'accent'}>
                {`+  ${shown}`}
            </Text>
        </Pressable>
    );
}

const dashed = {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.accent,
} as const;

const styles = StyleSheet.create({
    base: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: size.row,
        paddingHorizontal: space[3],
    },
    full: { ...dashed, alignSelf: 'stretch', borderRadius: radius.md },
    row: { ...dashed, alignSelf: 'stretch', borderRadius: radius.md, marginHorizontal: space[3] },
    footer: { alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: color.hair },
    compact: { alignSelf: 'flex-start', borderRadius: radius.full, backgroundColor: color.ink },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.32 },
});
