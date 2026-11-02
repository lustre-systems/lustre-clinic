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

// First run (SPEC §18 F1), and the front door: `app.json` ships no address, so
// the first launch of a shipped build lands here and someone types where the
// clinic PC is. A build that does carry a default — a dev machine's, or a
// clinic that baked its own in — has it probed on boot by
// `shell/serverStore.ts` and skips this screen when it answers. The rest of
// the traffic here is the clinic that moved its server and the typo: someone
// standing in front of the phone, correcting an address that did not answer.
//
// A prod build asks for the MagicDNS hostname alone: the clinic server listens
// only on Tailscale, so there is no LAN address that could answer, and no demo
// button beside a real clinic's register (`api/variant.ts`). Dev and demo builds
// keep the LAN field, tried first per §14, and the way into demo mode.
//
// Nothing is saved on the strength of the text being well-formed. The button
// probes, and only an address that answered is written down — a typo that lands
// the secretary in the offline dead end on the next launch is the one failure
// this screen exists to prevent. A probe that fails puts the previous addresses
// back rather than leaving a broken one behind.

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
    // A join link names the server its page came from. It fills in what is
    // empty and nothing else: the person still connects, and a prod build
    // still refuses an address off the tailnet.
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

    // The shell replaces this screen once the flag flips, so success has
    // nothing to draw.
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

    // A new phone or a reinstall: sign in, and the newest backup comes back,
    // held to every row check, and asking first if it would replace a clinic.
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

        // The server knows its own tailnet address and is now reachable, so ask
        // rather than keep what was typed — a hand-entered value is the older
        // of the two the moment the clinic moves. What was typed still stands
        // in when the clinic has not configured one.
        const learned = await learnTailnetAddress();
        // The shell replaces this screen as soon as the write lands, so the
        // success line is the handoff rather than something to dwell on.
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

                    {/* A clinic with no PC to run the server on. Its records
                        live on this phone, and leave it only as a backup to
                        the phone's own Google Drive. */}
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

                    {/* The way in to demo mode (the role-code screen offers it too, to a
                    dev or demo build). It is here rather
                    than anywhere inside the app because this is the screen a
                    phone with no clinic behind it lands on, and because a
                    control that swaps the register for a fake one should not
                    sit two taps from a real day's work. */}
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
    // The two hints carry what the standfirst used to say, so the fields start
    // closer to the heading than they did under a paragraph.
    fields: { alignSelf: 'stretch', gap: space[4], marginTop: space[5] },
    action: { marginTop: space[6] },
    result: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
    resultDot: { paddingTop: space[0.5] },
    alternatives: { alignSelf: 'stretch', alignItems: 'center', gap: space[3], marginTop: space[6] },
    or: { flexDirection: 'row', alignItems: 'center', gap: space[3], alignSelf: 'stretch' },
    orRule: { flex: 1, height: 1, backgroundColor: color.hair },
    localNote: { textAlign: 'center' },
});
