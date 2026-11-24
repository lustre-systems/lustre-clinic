import { Linking, StyleSheet, View } from 'react-native';
import { GLYPH } from '../components/domain';
import { Banner, Button, IconButton } from '../components/ui';
import { useT } from '../i18n';
import { useApkUpdate } from '../screens/settings/data/appUpdate';
import { color, space } from '../theme';
import { dismissApkUpdate, useDismissedApkUpdate } from './updateDismissStore';

export function ApkUpdateBanner() {
    const t = useT();
    const update = useApkUpdate();
    const dismissed = useDismissedApkUpdate();

    if (!update || !dismissed.hydrated || dismissed.versionCode === update.versionCode) return null;

    return (
        <Banner
            tone="info"
            message={t('New version ready · Lustre {version}', { version: update.version })}
            action={
                <View style={styles.actions}>
                    <Button
                        label="Download"
                        variant="text"
                        size="md"
                        onPress={() => void Linking.openURL(update.url)}
                        testID="home-apk-download"
                    />
                    <IconButton
                        accessibilityLabel="Dismiss"
                        icon={<GLYPH.close size={16} strokeWidth={2.2} color={color.ink2} />}
                        variant="bare"
                        onPress={() => dismissApkUpdate(update.versionCode)}
                        testID="home-apk-dismiss"
                    />
                </View>
            }
        />
    );
}

const styles = StyleSheet.create({
    actions: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
});
