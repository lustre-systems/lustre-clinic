import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import type { TextProps, TextVariant } from '../../theme';
import { Text } from '../../theme';

export type PlaceholderProps = {
    text?: string;
    visible: boolean;
    variant?: TextVariant;
    script?: TextProps['script'];
    align?: 'start' | 'end' | 'top';
};

export function Placeholder({ text, visible, variant = 'body', script, align = 'start' }: PlaceholderProps) {
    const t = useT();
    if (!visible || !text) return null;

    return (
        <View
            pointerEvents="none"
            style={[styles.overlay, align === 'end' && styles.end, align === 'top' && styles.top]}
        >
            <Text variant={variant} script={script} tone="muted" numberOfLines={1}>
                {t(text)}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        justifyContent: 'center',
    },
    end: { alignItems: 'flex-end' },
    top: { justifyContent: 'flex-start' },
});
