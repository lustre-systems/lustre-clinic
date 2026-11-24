import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { type RouterOutput, useTRPC } from '../../api';
import {
    ActionBar,
    Button,
    Callout,
    Card,
    Chevron,
    ConfirmSheet,
    Dot,
    EmptyState,
    IconButton,
    PushView,
    SectionLabel,
    Select,
    Tag,
    Textarea,
    TextField,
    Toast,
    usePendingAction,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { useBackHandler } from '../../shell/useBackHandler';
import { color, radius, space, Text } from '../../theme';
import { InfoIcon, PlusIcon, PowerIcon } from './components/icons';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { errorText } from './data/errors';

type Branch = RouterOutput['branch']['list'][number];

export function BranchesScreen({ onBack }: { onBack: () => void }) {
    const trpc = useTRPC();
    const t = useT();

    const branches = useQuery(trpc.branch.list.queryOptions({ includeInactive: true }));
    const editing = useRouteStack<Branch | 'new'>();
    const [toast, setToast] = useState<string | null>(null);

    const active = branches.data?.filter((b) => b.active) ?? [];
    const inactive = branches.data?.filter((b) => !b.active) ?? [];

    const pull = usePullToRefresh(branches.refetch, branches.isFetching);

    return (
        <>
            <Pane
                title="Branches"
                onBack={onBack}
                pull={pull}
                testID="settings-branches-pane"
                trailing={
                    branches.data ? (
                        <IconButton
                            accessibilityLabel="Add a branch"
                            variant="filled"
                            tone="ink"
                            icon={<PlusIcon size={13} />}
                            onPress={() => editing.push('new')}
                            testID="branch-add"
                        />
                    ) : undefined
                }
                overlay={
                    <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
                }
            >
                {branches.isLoading ? <SkeletonRows count={3} /> : null}

                {branches.error ? (
                    <ErrorState
                        message={errorText(branches.error)}
                        onRetry={branches.refetch}
                        retrying={branches.isFetching}
                    />
                ) : null}

                {branches.data ? (
                    <>
                        {active.length === 0 ? (
                            <EmptyState
                                weight="panel"
                                icon={<PlusIcon size={22} stroke={color.ink2} width={2.2} />}
                                title="No branches yet"
                                body="A branch is where an appointment happens. Add the clinic itself first."
                                actionLabel="Add a branch"
                                onAction={() => editing.push('new')}
                            />
                        ) : (
                            <View style={styles.section}>
                                <SectionLabel inset={false}>ACTIVE</SectionLabel>
                                {active.map((branch) => (
                                    <BranchCard
                                        key={branch.id}
                                        branch={branch}
                                        onPress={() => editing.push(branch)}
                                    />
                                ))}
                            </View>
                        )}

                        {inactive.length > 0 ? (
                            <View style={styles.section}>
                                <SectionLabel inset={false}>INACTIVE</SectionLabel>
                                {inactive.map((branch) => (
                                    <BranchCard
                                        key={branch.id}
                                        branch={branch}
                                        onPress={() => editing.push(branch)}
                                    />
                                ))}
                                <Text variant="footnote" tone="muted" style={styles.note}>
                                    {t(
                                        'Branches are never deleted — their visits, invoices and patients stay attached to them. Deactivating just hides a branch from new bookings.',
                                    )}
                                </Text>
                            </View>
                        ) : null}
                    </>
                ) : null}
            </Pane>

            {rendered(editing.stack).map(({ id, route: branch }, index) => (
                <PushView key={id} visible={isOpen(editing.stack, index)} onClosed={editing.settled}>
                    <BranchEditor
                        branch={branch === 'new' ? null : branch}
                        onClose={editing.pop}
                        onSaved={(message) => {
                            editing.pop();
                            setToast(message);
                        }}
                    />
                </PushView>
            ))}
        </>
    );
}

function BranchCard({ branch, onPress }: { branch: Branch; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={branch.name}
            onPress={onPress}
            testID={`branch-${branch.id}`}
            style={({ pressed }) => [
                styles.card,
                !branch.active && styles.inactiveCard,
                pressed && styles.pressed,
            ]}
        >
            <View style={styles.cardText}>
                <View style={styles.cardTitle}>
                    <Text variant="headline" tone={branch.active ? 'ink' : 'muted'}>
                        {branch.name}
                    </Text>
                    {branch.active ? null : <Tag tone="muted">INACTIVE</Tag>}
                </View>

                {branch.address ? (
                    <Text variant="footnote" tone="muted" numberOfLines={1}>
                        {branch.address}
                    </Text>
                ) : null}
            </View>

            <Chevron direction="forward" tone="muted" />
        </Pressable>
    );
}

type BranchEditorProps = {
    branch: Branch | null;
    onClose: () => void;
    onSaved: (message: string) => void;
};

function BranchEditor({ branch, onClose, onSaved }: BranchEditorProps) {
    const t = useT();
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const onBranchWritten = () => queryClient.invalidateQueries(trpc.branch.pathFilter());

    const [name, setName] = useState(branch?.name ?? '');
    const [address, setAddress] = useState(branch?.address ?? '');
    const [whatsApp, setWhatsApp] = useState(branch?.whatsappApp ?? 'regular');
    const [submitted, setSubmitted] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const create = useMutation(trpc.branch.create.mutationOptions({ onSuccess: onBranchWritten }));
    const update = useMutation(trpc.branch.update.mutationOptions({ onSuccess: onBranchWritten }));

    const write = usePendingAction((job: () => Promise<unknown>) => job());

    const nameError = submitted && name.trim() === '' ? 'A branch needs a name.' : undefined;
    const saving = write.pending && !confirming;
    const busy = write.pending;
    const failure = create.error ?? update.error;

    function onSave() {
        setSubmitted(true);
        if (name.trim() === '') return;

        const details = {
            name: name.trim(),
            address: address.trim() || null,
            whatsappApp: whatsApp,
        };

        write.run(async () => {
            if (!branch) {
                await create.mutateAsync(details);
                onSaved('Branch added');
                return;
            }
            await update.mutateAsync({ id: branch.id, ...details });
            onSaved('Branch saved');
        });
    }

    function onToggleActive() {
        if (!branch) return;

        write.run(async () => {
            const updated = await update.mutateAsync({ id: branch.id, active: !branch.active });
            setConfirming(false);
            onSaved(updated.active ? 'Branch reactivated' : 'Branch deactivated');
        });
    }

    useBackHandler(() => {
        if (!busy) onClose();
        return true;
    });

    return (
        <Pane
            title={branch ? 'Edit branch' : 'New branch'}
            onBack={busy ? () => {} : onClose}
            testID="branch-editor"
            footer={
                <ActionBar
                    primaryLabel={saving ? 'Saving' : branch ? 'Save branch' : 'Create branch'}
                    onPrimary={onSave}
                    primaryLoading={saving}
                    primaryDisabled={busy}
                />
            }
        >
            {failure ? (
                <Callout tone="warning" title="Not saved">
                    {errorText(failure)}
                </Callout>
            ) : null}

            {branch && !branch.active ? (
                <Callout tone="info" icon={<InfoIcon size={16} />}>
                    This branch is inactive. You can still edit its details and reopen it at any time.
                </Callout>
            ) : null}

            <View style={styles.section}>
                <SectionLabel inset={false}>DETAILS</SectionLabel>
                <Card padded style={styles.form}>
                    <TextField
                        label="Branch name"
                        required
                        value={name}
                        onChangeText={setName}
                        placeholder="Heliopolis"
                        error={nameError}
                        autoCapitalize="words"
                        testID="branch-name"
                    />
                    <Textarea
                        label="Address"
                        value={address}
                        onChangeText={setAddress}
                        placeholder="Street, area"
                        testID="branch-address"
                    />
                    <Select
                        label="Open WhatsApp in"
                        hint="Used when a phone has both WhatsApp apps."
                        options={[
                            { value: 'business', label: t('WhatsApp Business') },
                            { value: 'regular', label: t('WhatsApp') },
                        ]}
                        value={whatsApp}
                        onChange={setWhatsApp}
                        testID="branch-whatsapp-app"
                    />
                </Card>
            </View>

            {branch ? (
                <View style={styles.section}>
                    <SectionLabel inset={false}>STATUS</SectionLabel>

                    <Card padded style={styles.status}>
                        <View style={styles.statusHead}>
                            <Dot tone={branch.active ? 'wa' : 'muted'} size={8} />
                            <Text variant="body" weight="semibold" style={styles.statusLabel}>
                                {branch.active ? t('Active') : t('Inactive')}
                            </Text>
                        </View>

                        <Text variant="footnote" tone="muted">
                            {branch.active
                                ? t('Appears in the branch picker and can take new bookings.')
                                : t(
                                      'Hidden from the branch picker. Past visits and invoices are untouched and still searchable.',
                                  )}
                        </Text>

                        <Button
                            label={branch.active ? 'Deactivate branch' : 'Reactivate branch'}
                            variant={branch.active ? 'danger' : 'secondary'}
                            icon={
                                <PowerIcon
                                    size={15}
                                    stroke={branch.active ? color.danger : color.ink}
                                    width={2.2}
                                />
                            }
                            onPress={() => setConfirming(true)}
                            loading={write.pending && confirming}
                            block
                        />

                        <Text variant="caption" tone="muted" style={styles.noDelete}>
                            {t("Branches can't be deleted — history stays attached.")}
                        </Text>
                    </Card>
                </View>
            ) : null}

            <ConfirmSheet
                visible={confirming}
                title={branch?.active ? 'Deactivate this branch?' : 'Reactivate this branch?'}
                body={
                    branch?.active
                        ? 'It stops appearing when booking. Nothing is deleted — every appointment already at this branch keeps it.'
                        : 'It appears when booking again.'
                }
                confirmLabel={branch?.active ? 'Deactivate' : 'Reactivate'}
                destructive={branch?.active}
                loading={write.pending && confirming}
                onConfirm={onToggleActive}
                onCancel={() => setConfirming(false)}
            />
        </Pane>
    );
}

const styles = StyleSheet.create({
    section: { gap: space[2] },

    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[3.5],
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    inactiveCard: {
        borderStyle: 'dashed',
        borderColor: color.outline,
        backgroundColor: color.transparent,
    },
    pressed: { backgroundColor: color.surface2 },
    cardText: { flex: 1, minWidth: 0, gap: space[0.5] },
    cardTitle: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

    note: { paddingHorizontal: space[0.5] },
    form: { gap: space[4] },

    status: { gap: space[2.5] },
    statusHead: { flexDirection: 'row', alignItems: 'center', gap: space[2.5] },
    statusLabel: { flex: 1 },
    noDelete: { textAlign: 'center' },
});
