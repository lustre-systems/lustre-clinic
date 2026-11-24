import { StyleSheet, View } from 'react-native';
import { Card, SectionLabel } from '../../components/ui';
import { useT } from '../../i18n';
import { space, Text } from '../../theme';
import { Pane } from './components/Pane';
import { installedVersion } from './data/appUpdate';
import { apkLabel, updateLabel } from './data/appVersion';

const INSTALLED = installedVersion();

export type AboutScreenProps = {
    onBack: () => void;
};

export function AboutScreen({ onBack }: AboutScreenProps) {
    const t = useT();

    return (
        <Pane title="About" onBack={onBack} testID="settings-about-pane">
            <View style={styles.section}>
                <SectionLabel inset={false}>VERSION</SectionLabel>

                <Card padded style={styles.versionCard} testID="settings-about-version">
                    <VersionRow label="Version" value={INSTALLED.version ?? '—'} />
                    <VersionRow label="APK" value={apkLabel(INSTALLED)} />
                    <VersionRow label="Update" value={updateLabel(INSTALLED)} />
                </Card>

                <Text variant="footnote" tone="muted" style={styles.hint}>
                    {t('Updates download by themselves and apply the next time you come back to Lustre.')}
                </Text>
            </View>
        </Pane>
    );
}

function VersionRow({ label, value }: { label: string; value: string }) {
    const t = useT();
    return (
        <View style={styles.versionRow}>
            <Text variant="subhead" tone="muted">
                {t(label)}
            </Text>
            <Text variant="subhead" weight="semibold" script="mono">
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: space[2] },
    hint: { paddingHorizontal: space[0.5] },
    versionCard: { gap: space[2] },
    versionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
});
