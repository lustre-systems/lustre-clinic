import { StyleSheet, View } from 'react-native';
import { BUILD_VARIANT, showsDevBanner, useConnection } from '../api';
import { useT } from '../i18n';
import { color, size, space, Text } from '../theme';
import { DEV_LABEL, serverLabel } from './serverLabel';
import { useServerSetup } from './serverStore';

export function DevBanner() {
    const t = useT();
    const { baseUrl } = useConnection();
    const { addresses } = useServerSetup();

    if (!showsDevBanner(BUILD_VARIANT)) return null;

    const server = serverLabel(baseUrl, addresses);

    return (
        <View
            accessible
            accessibilityLabel={t('Development build, {server}', { server })}
            style={styles.strip}
        >
            <Text variant="eyebrow" tone="inverse">
                {DEV_LABEL}
            </Text>
            <Text variant="footnote" tone="inverse" numberOfLines={1} style={styles.server}>
                {server}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    strip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingHorizontal: size.gutter,
        paddingVertical: space[1.5],
        backgroundColor: color.due,
    },
    server: { flex: 1 },
});
