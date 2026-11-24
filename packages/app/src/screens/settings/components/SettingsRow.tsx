import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Chevron } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';

export type SettingsRowProps = {
    icon: ReactNode;
    label: string;
    sub: string;
    onPress: () => void;
    testID?: string;
};

export function SettingsRow({ icon, label, sub, onPress, testID }: SettingsRowProps) {
    const t = useT();
    const shownLabel = t(label);
    const shownSub = t(sub);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${shownLabel}. ${shownSub}`}
            onPress={onPress}
            testID={testID}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
            <View style={styles.tile}>{icon}</View>

            <View style={styles.text}>
                <Text variant="body" weight="semibold">
                    {shownLabel}
                </Text>
                <Text variant="footnote" tone="muted" numberOfLines={1}>
                    {shownSub}
                </Text>
            </View>

            <Chevron direction="forward" tone="muted" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[3],
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
    },
    pressed: { backgroundColor: color.surface2 },
    tile: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        backgroundColor: color.canvas,
    },
    text: { flex: 1, minWidth: 0, gap: space[0.5] },
});
