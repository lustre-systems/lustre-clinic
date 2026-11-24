import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
    type AddressKind,
    allowsDemo,
    allowsLan,
    BUILD_VARIANT,
    driveClientId,
    enableDemoMode,
    fetchDriveBackup,
    getConnectionState,
    isTailnetAddress,
    LocalStoreError,
    lastProbeRefused,
    listDriveBackups,
    type PickedClinic,
    reprobe,
    serverAddresses,
    startLocalMode,
    startLocalModeFrom,
} from '../api';
import { BrandMark } from '../components/domain';
import { Button, ConfirmSheet, Dot, TextField } from '../components/ui';
import { useT } from '../i18n';
import { color, radius, space, Text } from '../theme';
import { NOT_DEV_SERVER, NOT_ON_TAILNET, noAnswer, nothingEntered, toCandidate } from './address';
import { signInToDrive } from './driveSignIn';
import { usePendingJoin } from './joinLink';
import { applyAddresses, learnTailnetAddress, saveServerAddresses } from './serverStore';

type Attempt = { ok: true; address: AddressKind; ms: number } | { ok: false; message: string };

const ADDRESS_LABEL: Record<AddressKind, string> = {
    lan: 'the clinic wifi',
    tailscale: 'Tailscale',
};

const LAN_ALLOWED = allowsLan(BUILD_VARIANT);
const DEMO_ALLOWED = allowsDemo(BUILD_VARIANT);

export function SetupScreen() {
    const t = useT();
    const current = serverAddresses();
    const suggested = usePendingJoin()?.server ?? null;
    const onTailnet = suggested !== null && isTailnetAddress(suggested);
    const [lan, setLan] = useState(current.lan ?? (LAN_ALLOWED && suggested && !onTailnet ? suggested : ''));
    const [tailscale, setTailscale] = useState(current.tailscale ?? (onTailnet ? suggested : ''));
    const [testing, setTesting] = useState(false);
    const [attempt, setAttempt] = useState<Attempt | null>(null);
    const [startingLocal, setStartingLocal] = useState(false);
    const [localFailed, setLocalFailed] = useState(false);
    const [openingFile, setOpeningFile] = useState(false);
    const [restoringDrive, setRestoringDrive] = useState(false);
    const [fileProblem, setFileProblem] = useState<string | null>(null);
    const [replacing, setReplacing] = useState<PickedClinic | null>(null);

    async function runLocally() {
        setLocalFailed(false);
        setStartingLocal(true);
        try {
            await startLocalMode();
        } catch {
            setLocalFailed(true);
            setStartingLocal(false);
        }
    }

    async function restoreFromDrive() {
        setFileProblem(null);
        setLocalFailed(false);
        setRestoringDrive(true);
        try {
            const signedIn = await signInToDrive();
            if (signedIn !== 'linked') {
                if (signedIn === 'failed') setFileProblem('Could not sign in to Google Drive.');
                return;
            }
            const [newest] = await listDriveBackups();
            if (!newest) {
                setFileProblem('This Google account has no Lustre backups.');
                return;
            }
            const picked = await fetchDriveBackup(newest.id);
            if (picked.replaces) setReplacing(picked);
            else await openFile(picked);
        } catch (error) {
            setFileProblem(
                error instanceof LocalStoreError
                    ? 'That file is not a Lustre clinic, or this version of the app cannot read it.'
                    : 'Could not read the backup from Google Drive.',
            );
        } finally {
            setRestoringDrive(false);
        }
    }

    async function openFile(picked: PickedClinic) {
        setOpeningFile(true);
        try {
            await startLocalModeFrom(picked);
        } catch {
            setReplacing(null);
            setOpeningFile(false);
            setFileProblem('This phone could not open the clinic in that file.');
        }
    }

    async function connect() {
        const candidate = toCandidate({ lan, tailscale }, LAN_ALLOWED);
        if (!candidate.lan && !candidate.tailscale) {
            setAttempt({ ok: false, message: nothingEntered(LAN_ALLOWED) });
            return;
        }
        if (!LAN_ALLOWED && !isTailnetAddress(candidate.tailscale)) {
            setAttempt({ ok: false, message: NOT_ON_TAILNET });
            return;
        }

        const previous = serverAddresses();
        setAttempt(null);
        setTesting(true);

        applyAddresses(candidate);
        const startedAt = Date.now();
        const reached = await reprobe();
        const ms = Date.now() - startedAt;
        setTesting(false);

        if (!reached) {
            applyAddresses(previous);
            setAttempt({ ok: false, message: lastProbeRefused() ? NOT_DEV_SERVER : noAnswer(candidate) });
            return;
        }

        setAttempt({ ok: true, address: getConnectionState().address ?? 'lan', ms });

        const learned = await learnTailnetAddress();
        await saveServerAddresses({ lan: candidate.lan, tailscale: learned ?? candidate.tailscale });
    }

    return (
        <ScrollView
            style={styles.root}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
        >
            <View style={styles.card}>
                <BrandMark variant="clinic" size={24} />

                <Text variant="title3" style={styles.heading}>
                    {t('Connect to the clinic')}
                </Text>

                <View style={styles.fields}>
                    {LAN_ALLOWED ? (
                        <TextField
                            label={t('Clinic wifi')}
                            value={lan}
                            onChangeText={setLan}
                            placeholder="192.168.1.20:3000"
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            returnKeyType="next"
                            editable={!testing}
                        />
                    ) : null}

                    <TextField
                        label={t('Tailscale')}
                        value={tailscale}
                        onChangeText={setTailscale}
                        placeholder="clinic-pc.tailnet.ts.net:3000"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="done"
                        onSubmitEditing={() => void connect()}
                        editable={!testing}
                    />
                </View>

                <Button
                    label="Test & connect"
                    onPress={() => void connect()}
                    loading={testing}
                    variant="primary"
                    size="lg"
                    block
                    style={styles.action}
                />

                {attempt ? (
                    <View style={styles.result}>
                        <View style={styles.resultDot}>
                            <Dot tone={attempt.ok ? 'success' : 'danger'} />
                        </View>
                        <Text variant="footnote" tone={attempt.ok ? 'successText' : 'danger'}>
                            {attempt.ok
                                ? t('Answered over {route} in {seconds}', {
                                      route: t(ADDRESS_LABEL[attempt.address]),
                                      seconds: t('{seconds}s', { seconds: (attempt.ms / 1000).toFixed(1) }),
                                  })
                                : t(attempt.message)}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.alternatives}>
                    <View style={styles.or}>
                        <View style={styles.orRule} />
                        <Text variant="footnote" tone="muted">
                            {t('or')}
                        </Text>
                        <View style={styles.orRule} />
                    </View>

                    <Button
                        label="Use on this phone only"
                        onPress={() => void runLocally()}
                        variant="secondary"
                        size="md"
                        block
                        loading={startingLocal}
                        disabled={testing || openingFile}
                        testID="setup-local"
                    />
                    {localFailed ? (
                        <Text variant="footnote" tone="danger" style={styles.localNote}>
                            {t('This phone could not open its clinic. Nothing was changed.')}
                        </Text>
                    ) : null}

                    {driveClientId() ? (
                        <Button
                            label="Restore from Google Drive"
                            onPress={() => void restoreFromDrive()}
                            variant="ghost"
                            size="md"
                            block
                            loading={restoringDrive}
                            disabled={testing || startingLocal || openingFile}
                            testID="setup-restore-drive"
                        />
                    ) : null}
                    {fileProblem ? (
                        <Text variant="footnote" tone="danger" style={styles.localNote}>
                            {t(fileProblem)}
                        </Text>
                    ) : null}

                    {DEMO_ALLOWED ? (
                        <Button
                            label="Run in demo mode"
                            onPress={() => void enableDemoMode()}
                            variant="ghost"
                            size="md"
                            block
                            disabled={testing}
                        />
                    ) : null}
                </View>
            </View>

            <ConfirmSheet
                visible={replacing !== null}
                title="Replace the clinic on this phone?"
                body="This phone already has a clinic with patients in it. The clinic in the file takes its place."
                confirmLabel="Replace"
                destructive
                loading={openingFile}
                onConfirm={() => {
                    if (replacing) void openFile(replacing);
                }}
                onCancel={() => setReplacing(null)}
                testID="setup-replace-clinic"
            />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.canvas },
    content: { flexGrow: 1, justifyContent: 'center', padding: space[5] },
    card: {
        alignItems: 'center',
        gap: space[2],
        paddingVertical: space[8],
        paddingHorizontal: space[5],
        borderRadius: radius.xl2,
        backgroundColor: color.surface,
    },
    heading: { marginTop: space[5] },
    fields: { alignSelf: 'stretch', gap: space[4], marginTop: space[5] },
    action: { marginTop: space[6] },
    result: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
    resultDot: { paddingTop: space[0.5] },
    alternatives: { alignSelf: 'stretch', alignItems: 'center', gap: space[3], marginTop: space[6] },
    or: { flexDirection: 'row', alignItems: 'center', gap: space[3], alignSelf: 'stretch' },
    orRule: { flex: 1, height: 1, backgroundColor: color.hair },
    localNote: { textAlign: 'center' },
});
