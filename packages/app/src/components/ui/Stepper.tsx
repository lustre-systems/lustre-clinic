import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, space, Text } from '../../theme';

export type StepperProps = {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    format?: (value: number) => string;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
};

export function Stepper({
    value,
    onChange,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    step = 1,
    format,
    disabled = false,
    accessibilityLabel,
    testID,
}: StepperProps) {
    const t = useT();
    const canDecrement = !disabled && value - step >= min;
    const canIncrement = !disabled && value + step <= max;

    return (
        <View
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
            accessibilityValue={{ now: value, min, max }}
            accessibilityState={{ disabled, busy: disabled }}
            style={styles.track}
            testID={testID}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Decrease')}
                disabled={!canDecrement}
                onPress={() => onChange(value - step)}
                style={({ pressed }) => [
                    styles.button,
                    pressed && styles.pressed,
                    !canDecrement && styles.disabled,
                ]}
            >
                <Text variant="headline" weight="medium">
                    −
                </Text>
            </Pressable>

            <View style={styles.value}>
                <Text variant="amount">{format ? format(value) : String(value)}</Text>
            </View>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Increase')}
                disabled={!canIncrement}
                onPress={() => onChange(value + step)}
                style={({ pressed }) => [
                    styles.button,
                    pressed && styles.pressed,
                    !canIncrement && styles.disabled,
                ]}
            >
                <Text variant="headline" weight="medium">
                    +
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    track: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        padding: space[0.5],
        borderRadius: radius.md,
        backgroundColor: color.surface2,
    },
    button: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
    },
    value: { minWidth: 62, alignItems: 'center' },
    pressed: { backgroundColor: color.hair },
    disabled: { opacity: 0.32 },
});
