import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, size, space, Text } from '../../theme';
import { Chevron } from './Chevron';

export type TopBarProps = {
    title?: string;
    subtitle?: string;
    onBack?: () => void;
    backLabel?: string;
    trailing?: ReactNode;
    divider?: boolean;
};

export function TopBar({
    title,
    subtitle,
    onBack,
    backLabel = 'Back',
    trailing,
    divider = true,
}: TopBarProps) {
    const t = useT();

    return (
        <View style={[styles.bar, divider && styles.divider]}>
            <View style={styles.side}>
                {onBack ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t(backLabel)}
                        onPress={onBack}
                        hitSlop={12}
                        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
                    >
                        <Chevron direction="back" size={9} tone="ink" />
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.titles}>
                {title ? (
                    <Text variant="headline" numberOfLines={1}>
                        {t(title)}
                    </Text>
                ) : null}
                {subtitle ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                        {t(subtitle)}
                    </Text>
                ) : null}
            </View>

            <View style={styles.side}>{trailing}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        minHeight: size.button,
        paddingHorizontal: space[3],
        backgroundColor: color.surface,
    },
    divider: { borderBottomWidth: 1, borderBottomColor: color.hair },
    side: { minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    titles: { flex: 1, alignItems: 'center' },
    pressed: { opacity: 0.6 },
});
