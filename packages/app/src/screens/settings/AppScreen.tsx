import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { allowsLan, BUILD_VARIANT } from '../../api';
import { Button, Card, ConfirmSheet, Dot, SectionLabel } from '../../components/ui';
import { useT } from '../../i18n';
import { disconnectServer } from '../../shell/serverStore';
import { color, space, Text } from '../../theme';
import { ReprobeIcon } from './components/icons';
import { Pane } from './components/Pane';
import { useConnectionView } from './data/connection';

export type AppScreenProps = {
    onBack: () => void;
};

export function AppScreen({ onBack }: AppScreenProps) {
    const t = useT();
    const connection = useConnectionView();
    const [disconnecting, setDisconnecting] = useState(false);

    return (
        <Pane title="App" onBack={onBack} testID="settings-app">
            <View style={styles.section}>
                <SectionLabel inset={false}>SERVER CONNECTION</SectionLabel>

                <Card padded style={styles.serverCard}>
                    <View style={styles.serverHead}>
                        <Dot tone={connection.tone} size={8} pulse={connection.pulse} />
                        <Text variant="body" weight="semibold" style={styles.serverName}>
                            {connection.serverName}
                        </Text>
                        <Text variant="footnote" weight="semibold" tone={statusTone(connection.kind)}>
                            {t(connection.label)}
                        </Text>
                    </View>

                    <Text variant="subhead" weight="medium" tone="muted" script="mono">
                        {connection.serverAddress}
                    </Text>

                    <View style={styles.probe}>
                        <Text variant="footnote" tone="muted" script="mono" style={styles.stamp}>
                            {connection.stamp ?? t('Not checked yet')}
                        </Text>
                        <Button
                            label={connection.probing ? t('Probing…') : t('Re-probe')}
                            variant="secondary"
                            size="md"
                            onPress={connection.reprobe}
                            loading={connection.probing}
                            icon={<ReprobeIcon size={14} stroke={color.ink} width={2.2} />}
                            testID="settings-app-reprobe"
                        />
                    </View>
                </Card>

                <Text variant="footnote" tone="muted" style={styles.hint}>
                    {t(
                        allowsLan(BUILD_VARIANT)
                            ? 'Lustre prefers the clinic server when you are on its wifi and falls back to the tailnet elsewhere. Re-probe if the app is stuck on the wrong one.'
                            : 'Lustre reaches the clinic server over Tailscale. Re-probe if it has stopped answering.',
                    )}
                </Text>
            </View>

            {connection.kind === 'device' ? null : (
                <View style={styles.section}>
                    <Button
                        label="Disconnect from server"
                        variant="dangerText"
                        size="md"
                        block
                        onPress={() => setDisconnecting(true)}
                        testID="settings-app-disconnect"
                    />
                    <ConfirmSheet
                        visible={disconnecting}
                        title="Disconnect from this server?"
                        body="This phone forgets the server and its role there, and goes back to setup. Connect to it again and it will need a new role code."
                        confirmLabel="Disconnect"
                        destructive
                        onConfirm={() => void disconnectServer()}
                        onCancel={() => setDisconnecting(false)}
                        testID="settings-app-disconnect-confirm"
                    />
                </View>
            )}
        </Pane>
    );
}

function statusTone(kind: ReturnType<typeof useConnectionView>['kind']) {
    if (kind === 'wifi') return 'wa' as const;
    if (kind === 'offline') return 'due' as const;
    return 'muted' as const;
}

const styles = StyleSheet.create({
    section: { gap: space[2] },
    serverCard: { gap: space[1.5] },
    serverHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    serverName: { flex: 1, minWidth: 0 },

    probe: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        marginTop: space[1.5],
        paddingTop: space[3],
        borderTopWidth: 1,
        borderTopColor: color.hair,
    },
    stamp: { flex: 1 },

    hint: { paddingHorizontal: space[0.5] },
});
