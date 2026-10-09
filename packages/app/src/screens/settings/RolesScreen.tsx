/**
 * Settings → Phones & role codes. The admin's pane, and the only place a role
 * is handed out: pick the role, name the phone it is for, and hold the QR up to
 * that phone's camera. A code works once, for `GRANT_TTL_MINUTES`.
 *
 * The list is what is live: codes waiting to be scanned, and the phones using
 * theirs. A code withdrawn, replaced by the phone's next one, or left unused
 * past its expiry is deleted, not listed. Withdrawing a used code shuts its
 * phone out at once. This phone's own code cannot be withdrawn from here: the
 * last admin revoking itself would leave only the server's CLI to get back in.
 *
 * The switch at the top is the upgrade path's end. Off, a phone that has never
 * scanned a code keeps working as it did before roles existed; the admin turns
 * it on once every phone in the clinic has one.
 */
import {
    clinicWallClock,
    GRANT_TTL_MINUTES,
    grantCodeOf,
    joinUrl,
    MAX_DEVICE_LABEL,
    ROLES,
    type Role,
    todayKey,
} from '@lustre/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { getConnectionState, type RouterOutput, useCredential, useDemoMode, useTRPC } from '../../api';
import { formatStamp } from '../../components/domain';
import {
    ActionBar,
    Button,
    Card,
    CardDivider,
    ConfirmSheet,
    SectionLabel,
    SegmentedControl,
    Sheet,
    Switch,
    Tag,
    type TagTone,
    TextField,
    Toast,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { space, Text } from '../../theme';
import { Pane } from './components/Pane';
import { QrCode } from './components/QrCode';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { errorText } from './data/errors';
import { ROLE_NAME } from './ScanCodeScreen';

type Grant = RouterOutput['device']['grants'][number];
type Issued = RouterOutput['device']['issue'];

const STATUS: Record<Grant['status'], { label: string; tone: TagTone }> = {
    pending: { label: 'Waiting', tone: 'accent' },
    redeemed: { label: 'In use', tone: 'success' },
};

function when(iso: string | Date): string {
    const at = clinicWallClock(iso);
    const time = formatStamp(new Date(iso).getTime());
    return at.key === todayKey() ? time : `${at.day}/${at.month} ${time}`;
}

export function RolesScreen({ onBack }: { onBack: () => void }) {
    const trpc = useTRPC();
    const t = useT();
    const queryClient = useQueryClient();
    const { credential } = useCredential();

    const grants = useQuery(trpc.device.grants.queryOptions());
    const settings = useQuery(trpc.settings.get.queryOptions());
    const pull = usePullToRefresh(grants.refetch, grants.isFetching);

    const [toast, setToast] = useState<string | null>(null);
    const [making, setMaking] = useState(false);
    const [revoking, setRevoking] = useState<Grant | null>(null);
    const [requiring, setRequiring] = useState(false);

    const refresh = () => queryClient.invalidateQueries(trpc.device.pathFilter());
    const revoke = useMutation(trpc.device.revoke.mutationOptions({ onSuccess: refresh }));
    const require = useMutation(
        trpc.device.setRequireProvisioning.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries(trpc.settings.pathFilter()),
        }),
    );

    const withdraw = usePendingAction(async (grant: Grant) => {
        try {
            await revoke.mutateAsync({ grantId: grant.id });
            setToast(t('Code for {label} withdrawn', { label: grant.label }));
        } catch (error) {
            setToast(errorText(error));
        } finally {
            setRevoking(null);
        }
    });

    const setRequired = usePendingAction(async (required: boolean) => {
        try {
            await require.mutateAsync({ required });
        } catch (error) {
            setToast(errorText(error));
        } finally {
            setRequiring(false);
        }
    });

    const required = settings.data?.requireProvisioning ?? false;
    const inUse = grants.data?.filter((grant) => grant.status === 'redeemed').length ?? 0;

    return (
        <Pane
            title="Phones & role codes"
            onBack={onBack}
            pull={pull}
            testID="settings-roles-pane"
            footer={
                <ActionBar
                    primaryLabel="New role code"
                    onPrimary={() => setMaking(true)}
                    testID="roles-new"
                />
            }
            overlay={
                <>
                    <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
                    <MakeCodeSheet visible={making} onClose={() => setMaking(false)} onMade={refresh} />
                    <ConfirmSheet
                        visible={revoking !== null}
                        title="Withdraw this code?"
                        body={
                            revoking?.status === 'redeemed'
                                ? 'The phone it was used on stops working until it scans a new code.'
                                : 'Nobody will be able to use it.'
                        }
                        confirmLabel="Withdraw"
                        destructive
                        loading={withdraw.pending}
                        onConfirm={() => revoking && withdraw.run(revoking)}
                        onCancel={() => setRevoking(null)}
                    />
                    <ConfirmSheet
                        visible={requiring}
                        title="Ask every phone for a code?"
                        body="A phone that has not scanned a role code stops working until it does. Turn this on once every phone has one."
                        confirmLabel="Turn on"
                        loading={setRequired.pending}
                        onConfirm={() => setRequired.run(true)}
                        onCancel={() => setRequiring(false)}
                    />
                </>
            }
        >
            <Card padded>
                <View style={styles.switchRow}>
                    <View style={styles.switchText}>
                        <Text variant="body" weight="semibold">
                            {t('Every phone needs a role code')}
                        </Text>
                        <Text variant="footnote" tone="muted">
                            {t(
                                required
                                    ? 'Phones without one are refused.'
                                    : 'Off: phones without a code still work, as before. Phones with a code: {count}.',
                                { count: inUse },
                            )}
                        </Text>
                    </View>
                    <Switch
                        value={required}
                        disabled={!settings.data || setRequired.pending}
                        accessibilityLabel="Every phone needs a role code"
                        onValueChange={(next) => (next ? setRequiring(true) : setRequired.run(false))}
                        testID="roles-require"
                    />
                </View>
            </Card>

            <View style={styles.section}>
                <SectionLabel inset={false}>CODES</SectionLabel>
                {grants.isLoading ? <SkeletonRows count={3} /> : null}
                {grants.error ? (
                    <ErrorState
                        message={errorText(grants.error)}
                        onRetry={grants.refetch}
                        retrying={grants.isFetching}
                    />
                ) : null}
                {grants.data?.length === 0 ? (
                    <Text variant="subhead" tone="muted">
                        {t('No codes yet. Make one for each phone in the clinic.')}
                    </Text>
                ) : null}
                {grants.data && grants.data.length > 0 ? (
                    <Card>
                        {grants.data.map((grant, index) => {
                            const mine = grant.deviceId !== null && grant.deviceId === credential?.deviceId;
                            return (
                                <View key={grant.id}>
                                    {index > 0 ? <CardDivider /> : null}
                                    <GrantRow
                                        grant={grant}
                                        mine={mine}
                                        onPress={mine ? undefined : () => setRevoking(grant)}
                                    />
                                </View>
                            );
                        })}
                    </Card>
                ) : null}
            </View>
        </Pane>
    );
}

function GrantRow({ grant, mine, onPress }: { grant: Grant; mine: boolean; onPress?: () => void }) {
    const t = useT();
    const status = STATUS[grant.status];
    const detail =
        grant.status === 'redeemed' && grant.redeemedAt
            ? t('Scanned {when}', { when: when(grant.redeemedAt) })
            : t('Until {when}', { when: when(grant.expiresAt) });

    return (
        <Pressable
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityHint={onPress ? 'Withdraw this code' : undefined}
            disabled={!onPress}
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`roles-grant-${grant.id}`}
        >
            <View style={styles.rowText}>
                <Text variant="body" weight="semibold" numberOfLines={1}>
                    {grant.label}
                    {mine ? ` · ${t('this phone')}` : ''}
                </Text>
                <Text variant="footnote" tone="muted" numberOfLines={1}>
                    {`${t(ROLE_NAME[grant.role])} · ${detail}`}
                </Text>
            </View>
            <Tag tone={status.tone} variant="muted">
                {status.label}
            </Tag>
        </Pressable>
    );
}

/**
 * The QR's text: the join page on the server this phone is talking to, so a
 * phone without the app can scan it with its camera and be offered the app
 * (`device.http.ts`). The demo has no server to point at, and keeps the bare code.
 */
function qrValue(payload: string, demo: boolean): string {
    const base = demo ? null : getConnectionState().baseUrl;
    const code = grantCodeOf(payload);
    return base && code ? joinUrl(base, code) : payload;
}

/**
 * Two steps in one sheet: what the code is for, then the code. The QR is shown
 * once — the server keeps only its hash — so closing the sheet is the end of it,
 * and a phone that did not get to scan it needs a new one.
 */
function MakeCodeSheet({
    visible,
    onClose,
    onMade,
}: {
    visible: boolean;
    onClose: () => void;
    onMade: () => void;
}) {
    const trpc = useTRPC();
    const demo = useDemoMode();
    const t = useT();
    const [role, setRole] = useState<Role>('secretary');
    const [label, setLabel] = useState('');
    const [issued, setIssued] = useState<Issued | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const issue = useMutation(trpc.device.issue.mutationOptions({ onSuccess: onMade }));

    const make = usePendingAction(async () => {
        setProblem(null);
        try {
            setIssued(await issue.mutateAsync({ role, label: label.trim() }));
        } catch (error) {
            setProblem(errorText(error));
        }
    });

    function closed() {
        setIssued(null);
        setLabel('');
        setProblem(null);
    }

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            onClosed={closed}
            title={issued ? 'Scan this on the new phone' : 'New role code'}
            footer={
                issued ? (
                    <Button label="Done" size="lg" block onPress={onClose} testID="roles-code-done" />
                ) : (
                    <Button
                        label="Make the code"
                        size="lg"
                        block
                        disabled={label.trim() === ''}
                        loading={make.pending}
                        onPress={() => make.run()}
                        testID="roles-make"
                    />
                )
            }
            testID="roles-make-sheet"
        >
            {issued ? (
                <View style={styles.code}>
                    <QrCode value={qrValue(issued.payload, demo.enabled)} size={264} testID="roles-qr" />
                    <Text variant="subhead" tone="muted" style={styles.codeText}>
                        {t(
                            '{role} code for {label}. Scan it with that phone’s camera, or in Lustre: Settings → Scan a role code. Works once, until {when}.',
                            {
                                role: t(ROLE_NAME[issued.role]),
                                label: issued.label,
                                when: when(issued.expiresAt),
                            },
                        )}
                    </Text>
                </View>
            ) : (
                <View style={styles.form}>
                    <SegmentedControl
                        segments={ROLES.map((value) => ({ value, label: ROLE_NAME[value] }))}
                        value={role}
                        onChange={setRole}
                        accessibilityLabel="Role"
                        testID="roles-role"
                    />
                    <TextField
                        label="Which phone"
                        placeholder="Reception"
                        value={label}
                        onChangeText={setLabel}
                        maxLength={MAX_DEVICE_LABEL}
                        hint={t('Works once, for {minutes} minutes.', { minutes: GRANT_TTL_MINUTES })}
                        testID="roles-label"
                    />
                    {problem ? (
                        <Text variant="footnote" tone="danger">
                            {problem}
                        </Text>
                    ) : null}
                </View>
            )}
        </Sheet>
    );
}

const styles = StyleSheet.create({
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    switchText: { flex: 1, gap: space[0.5] },
    section: { gap: space[2], marginTop: space[4.5] },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3.5] },
    rowText: { flex: 1, minWidth: 0, gap: space[0.5] },
    pressed: { opacity: 0.6 },
    code: { alignItems: 'center', gap: space[3], paddingVertical: space[2] },
    codeText: { textAlign: 'center' },
    form: { gap: space[4] },
});
