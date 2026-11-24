import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, space, Text } from '../../theme';

export type ReorderControlsProps = {
    onMoveUp: () => void;
    onMoveDown: () => void;
    isFirst?: boolean;
    isLast?: boolean;
    itemLabel?: string;
};

export function ReorderControls({
    onMoveUp,
    onMoveDown,
    isFirst = false,
    isLast = false,
    itemLabel,
}: ReorderControlsProps) {
    const t = useT();

    return (
        <View style={styles.stack}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={itemLabel ? t('Move up {item}', { item: itemLabel }) : t('Move up')}
                accessibilityState={{ disabled: isFirst }}
                disabled={isFirst}
                onPress={onMoveUp}
                style={({ pressed }) => [
                    styles.button,
                    pressed && styles.pressed,
                    isFirst && styles.disabled,
                ]}
            >
                <Text variant="footnote" weight="semibold">
                    {'↑'}
                </Text>
            </Pressable>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={itemLabel ? t('Move down {item}', { item: itemLabel }) : t('Move down')}
                accessibilityState={{ disabled: isLast }}
                disabled={isLast}
                onPress={onMoveDown}
                style={({ pressed }) => [styles.button, pressed && styles.pressed, isLast && styles.disabled]}
            >
                <Text variant="footnote" weight="semibold">
                    {'↓'}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    stack: { gap: space[0.5] },
    button: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    pressed: { backgroundColor: color.surface2 },
    disabled: { opacity: 0.32 },
});
