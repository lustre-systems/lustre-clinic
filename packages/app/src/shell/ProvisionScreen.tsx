import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
    allowsDemo,
    BUILD_VARIANT,
    enableDemoMode,
    type Refusal,
    resetDemoData,
    retryProvisioning,
    useDemoMode,
} from '../api';
import { GLYPH } from '../components/domain';
import { Button, PushView, useHardwareBack } from '../components/ui';
import { useT } from '../i18n';
import { ScanCodeScreen } from '../screens/settings';
import { color, space } from '../theme';
import { DeadEnd } from './DeadEnd';

const TITLE: Record<Exclude<Refusal, 'none'>, string> = {
    new: 'Scan your role code',
    unprovisioned: 'This phone needs a role code',
    revoked: 'This phone’s role was withdrawn',
};

const DEMO_ALLOWED = allowsDemo(BUILD_VARIANT);

const BODY: Record<Exclude<Refusal, 'none'>, string> = {
    new: 'Ask the clinic’s admin for a code for this phone, then scan it. It decides what this phone can do.',
    unprovisioned: 'The clinic now asks every phone for a role code. Ask the admin for one, then scan it.',
    revoked: 'An admin withdrew the role this phone had. Ask them for a new code, then scan it.',
};

export function ProvisionScreen({ refusal }: { refusal: Exclude<Refusal, 'none'> }) {
    const t = useT();
    const [scanning, setScanning] = useState(false);
    const inDemo = useDemoMode().enabled;
    useHardwareBack(scanning, () => {
        setScanning(false);
        return true;
    });

    return (
        <View style={styles.root}>
            <DeadEnd
                glyph={<GLYPH.scanCode size={22} color={color.ink2} strokeWidth={2} />}
                title={t(TITLE[refusal])}
                body={t(BODY[refusal])}
            >
                <Button
                    label="Scan a role code"
                    onPress={() => setScanning(true)}
                    variant="primary"
                    size="lg"
                    block
                    style={styles.action}
                    testID="provision-scan"
                />

                {refusal === 'unprovisioned' ? (
                    <Button
                        label="Try again"
                        onPress={retryProvisioning}
                        variant="text"
                        size="md"
                        style={styles.retry}
                        testID="provision-retry"
                    />
                ) : null}

                {DEMO_ALLOWED ? (
                    <Button
                        label={inDemo ? 'Reset demo data' : 'Enter demo mode'}
                        onPress={() => void (inDemo ? resetDemoData() : enableDemoMode())}
                        variant="ghost"
                        size="md"
                        block
                        style={styles.demo}
                        testID="provision-demo"
                    />
                ) : null}
            </DeadEnd>

            <PushView visible={scanning} testID="provision-scan-pane">
                <ScanCodeScreen onBack={() => setScanning(false)} onGranted={() => setScanning(false)} />
            </PushView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    action: { marginTop: space[4] },
    demo: { marginTop: space[2] },
    retry: { marginTop: space[2], alignSelf: 'center' },
});
