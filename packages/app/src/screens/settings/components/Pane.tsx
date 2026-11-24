import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PullToRefresh } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { BackIcon } from './icons';

export type PaneProps = {
    title: string;
    subtitle?: string;
    onBack: () => void;
    trailing?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    overlay?: ReactNode;
    pull?: PullToRefresh;
    testID?: string;
};
export function Pane({
    title,
    subtitle,
    onBack,
    trailing,
    children,
    footer,
    overlay,
    pull,
    testID,
}: PaneProps) {
    const t = useT();
    return (
        <View style={styles.pane} testID={testID}>
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Back')}
                    onPress={onBack}
                    hitSlop={12}
                    style={({ pressed }) => [styles.back, pressed && styles.pressed]}
                >
                    <BackIcon size={15} />
                </Pressable>

                <View style={styles.titles}>
                    <Text variant="title3" numberOfLines={1} accessibilityRole="header">
                        {t(title)}
                    </Text>
                    {subtitle ? (
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                            {t(subtitle)}
                        </Text>
                    ) : null}
                </View>

                {trailing}
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                refreshControl={pull?.refreshControl}
                {...pull?.scrollProps}
            >
                {children}
            </ScrollView>

            {footer}
            {overlay}
        </View>
    );
}

const styles = StyleSheet.create({
    pane: { flex: 1, backgroundColor: color.canvas },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingStart: space[4.5],
        paddingEnd: size.bleed,
        paddingTop: space[2],
        paddingBottom: space[3.5],
    },
    back: {
        width: 34,
        height: 34,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.outline,
        backgroundColor: color.surface,
    },
    pressed: { opacity: 0.6 },
    titles: { flex: 1, minWidth: 0 },

    scroll: { flex: 1 },
    content: { padding: size.gutter, gap: space[4], paddingBottom: space[12] },
});
