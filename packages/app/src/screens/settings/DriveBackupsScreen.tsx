/**
 * Settings → Backups, for a clinic kept on this phone: link the
 * account, back up now, bring a backup back, and take it all away again.
 *
 * The backups sit in Drive's hidden app folder, which nobody can open by hand.
 * So everything that can be done to them has to be here, and deleting comes
 * before unlinking: once unlinked, this app cannot reach them either.
 */
import { dateKey } from '@lustre/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
    BACKUPS_KEPT,
    backUpIfDue,
    backUpToDrive,
    type DriveBackup,
    deleteDriveBackups,
    fetchDriveBackup,
    LocalStoreError,
    listDriveBackups,
    type PickedClinic,
    startLocalModeFrom,
    unlinkDrive,
    useTRPC,
} from '../../api';
import { formatStamp } from '../../components/domain';
import { Button, Card, SectionLabel, Sheet, usePendingAction } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { unregisterDriveBackupTask } from '../../shell/driveBackupTask';
import { signInToDrive } from '../../shell/driveSignIn';
import { color, space, Text } from '../../theme';
import { formatDate } from '../day/time';
import { Pane } from './components/Pane';

type Confirm = { kind: 'restore'; backup: DriveBackup } | { kind: 'delete' } | { kind: 'unlink' } | null;

export function DriveBackupsScreen({ onBack }: { onBack: () => void }) {
    const t = useT();
    const locale = useLocale();
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const status = useQuery(trpc.backup.status.queryOptions());
    const offsite = status.data?.offsite;
    const linked = offsite?.configured === true;
    const signedOut = Boolean(offsite?.reauthorizationRequiredSince);

    const backups = useQuery({
        queryKey: ['drive-backups'],
        queryFn: listDriveBackups,
        enabled: linked && !signedOut,
        retry: false,
    });
    const [confirm, setConfirm] = useState<Confirm>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function refresh() {
        await queryClient.invalidateQueries(trpc.backup.status.queryFilter());
        await queryClient.invalidateQueries({ queryKey: ['drive-backups'] });
    }

    const signIn = usePendingAction(async () => {
        setMessage(null);
        const result = await signInToDrive();
        if (result === 'failed') setMessage('Could not sign in to Google Drive.');
        // The first backup, now rather than the next time the app comes to the front.
        if (result === 'linked') await backUpIfDue().catch(() => undefined);
        await refresh();
    });

    const backUp = usePendingAction(async () => {
        setMessage(null);
        try {
            await backUpToDrive();
            setMessage('Backed up to Google Drive.');
        } catch {
            setMessage('Could not back up to Google Drive. Nothing was changed.');
        }
        await refresh();
    });

    const restore = usePendingAction(async (backup: DriveBackup) => {
        setConfirm(null);
        setMessage(null);
        try {
            const picked: PickedClinic = await fetchDriveBackup(backup.id);
            await startLocalModeFrom(picked);
        } catch (error) {
            setMessage(
                error instanceof LocalStoreError
                    ? 'That file is not a Lustre clinic, or this version of the app cannot read it.'
                    : 'Could not read the backup from Google Drive.',
            );
        }
        await refresh();
    });

    const remove = usePendingAction(async () => {
        setConfirm(null);
        setMessage(null);
        try {
            await deleteDriveBackups();
            setMessage('The backups were deleted from Google Drive.');
        } catch {
            setMessage('Could not delete every backup. Try again.');
        }
        await refresh();
    });

    const unlink = usePendingAction(async () => {
        setConfirm(null);
        setMessage(null);
        await unlinkDrive();
        await unregisterDriveBackupTask().catch(() => undefined);
        await refresh();
    });

    const busy = signIn.pending || backUp.pending || restore.pending || remove.pending || unlink.pending;

    return (
        <Pane title="Backups" onBack={onBack} testID="settings-drive-backups-pane">
            <View style={styles.section}>
                <Card padded style={styles.card}>
                    <Text variant="body" weight="semibold">
                        {signedOut
                            ? t('Google Drive needs a new sign-in')
                            : linked
                              ? (offsite?.account ?? t('Google Drive'))
                              : t('Not linked')}
                    </Text>
                    <Text variant="subhead" tone="muted">
                        {t(
                            'Once a day when the clinic has changed, a copy goes to a hidden folder in this Google account. The last {count} are kept. They do not show in Drive, and can only be restored from this app.',
                            { count: BACKUPS_KEPT },
                        )}
                    </Text>
                </Card>

                {message ? (
                    <Text variant="footnote" tone="muted" style={styles.note} testID="drive-message">
                        {t(message)}
                    </Text>
                ) : null}

                {!linked || signedOut ? (
                    <Button
                        label="Sign in with Google"
                        onPress={signIn.run}
                        loading={signIn.pending}
                        disabled={busy}
                        block
                        testID="drive-sign-in"
                    />
                ) : (
                    <Button
                        label="Back up now"
                        onPress={backUp.run}
                        loading={backUp.pending}
                        disabled={busy}
                        block
                        testID="drive-back-up-now"
                    />
                )}

                {linked && !signedOut ? (
                    <>
                        <SectionLabel inset={false}>BACKUPS</SectionLabel>
                        {backups.isLoading ? (
                            <Text variant="subhead" tone="muted" style={styles.note}>
                                {t('Checking…')}
                            </Text>
                        ) : null}
                        {backups.error ? (
                            <Text variant="subhead" tone="danger" style={styles.note}>
                                {t('Could not read the backups from Google Drive.')}
                            </Text>
                        ) : null}
                        {backups.data?.length === 0 ? (
                            <Text variant="subhead" tone="muted" style={styles.note}>
                                {t('No backups yet')}
                            </Text>
                        ) : null}
                        {backups.data?.map((backup, index) => (
                            <Card padded key={backup.id} style={styles.backup}>
                                <View style={styles.backupText}>
                                    <Text variant="subhead" weight="semibold" numberOfLines={1}>
                                        {`${formatDate(dateKey(backup.createdAt))} · ${formatStamp(new Date(backup.createdAt).getTime(), locale)}`}
                                    </Text>
                                    <Text variant="footnote" tone="muted">
                                        {t('{size} KB', {
                                            size: Math.max(1, Math.round(backup.bytes / 1024)),
                                        })}
                                    </Text>
                                </View>
                                <Button
                                    label="Restore"
                                    variant="accent"
                                    size="md"
                                    onPress={() => setConfirm({ kind: 'restore', backup })}
                                    disabled={busy}
                                    testID={`drive-restore-${index}`}
                                />
                            </Card>
                        ))}
                    </>
                ) : null}

                {linked ? (
                    <View style={styles.leave}>
                        {!signedOut ? (
                            <Button
                                label="Delete backups from Drive"
                                variant="danger"
                                size="md"
                                onPress={() => setConfirm({ kind: 'delete' })}
                                disabled={busy || !backups.data?.length}
                                block
                                testID="drive-delete"
                            />
                        ) : null}
                        <Button
                            label="Unlink Google Drive"
                            variant="danger"
                            size="md"
                            onPress={() => setConfirm({ kind: 'unlink' })}
                            disabled={busy}
                            block
                            testID="drive-unlink"
                        />
                    </View>
                ) : null}
            </View>

            <Sheet
                visible={confirm !== null}
                onClose={() => setConfirm(null)}
                title={
                    confirm?.kind === 'restore'
                        ? 'Restore this backup?'
                        : confirm?.kind === 'delete'
                          ? 'Delete every backup from Drive?'
                          : 'Unlink Google Drive?'
                }
                subtitle={
                    confirm?.kind === 'restore'
                        ? 'The clinic on this phone is replaced by this backup. Anything saved since then is set aside on the phone, not kept in the clinic.'
                        : confirm?.kind === 'delete'
                          ? 'This cannot be undone. The clinic on this phone is not touched, but this phone will then hold the only copy.'
                          : 'Backups stop. The ones already in Drive stay there, hidden, and this app can reach them only after signing in again. To remove them, delete them first.'
                }
                testID="drive-confirm-sheet"
                footer={
                    <>
                        <Button
                            label={
                                confirm?.kind === 'restore'
                                    ? 'Restore'
                                    : confirm?.kind === 'delete'
                                      ? 'Delete backups'
                                      : 'Unlink'
                            }
                            variant={confirm?.kind === 'restore' ? 'accent' : 'danger'}
                            onPress={() => {
                                if (confirm?.kind === 'restore') restore.run(confirm.backup);
                                else if (confirm?.kind === 'delete') remove.run();
                                else unlink.run();
                            }}
                            block
                            testID="drive-confirm"
                        />
                        <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} block />
                    </>
                }
            >
                {null}
            </Sheet>
        </Pane>
    );
}

const styles = StyleSheet.create({
    section: { gap: space[2] },
    card: { gap: space[2] },
    note: { paddingHorizontal: space[0.5] },
    backup: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    backupText: { flex: 1, minWidth: 0, gap: space[0.5] },
    leave: {
        gap: space[1],
        marginTop: space[3],
        paddingTop: space[3],
        borderTopWidth: 1,
        borderTopColor: color.hair,
    },
});
