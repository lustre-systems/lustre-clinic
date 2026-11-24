import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { serverNow, useTRPC } from '../../api';
import { formatStamp } from '../../components/domain';
import { Button, Card, Dot, SectionLabel } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { color, space, Text } from '../../theme';
import { Pane } from './components/Pane';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { backupDetails } from './data/backups';
import { errorText } from './data/errors';

export type BackupsScreenProps = {
    onBack: () => void;
    onChangeAccount?: () => void;
};

export function BackupsScreen({ onBack, onChangeAccount }: BackupsScreenProps) {
    const t = useT();
    const locale = useLocale();
    const trpc = useTRPC();
    const status = useQuery(trpc.backup.status.queryOptions());

    const details = status.data
        ? backupDetails(status.data, serverNow(), t, (at) => formatStamp(at, locale))
        : null;

    return (
        <Pane title="Backups" onBack={onBack} testID="settings-backups-pane">
            {status.isLoading ? <SkeletonRows count={2} /> : null}

            {status.error && !status.data ? (
                <ErrorState
                    message={errorText(status.error)}
                    onRetry={() => void status.refetch()}
                    retrying={status.isFetching}
                />
            ) : null}

            {details ? (
                <View style={styles.section}>
                    <SectionLabel inset={false}>STATUS</SectionLabel>

                    {status.error ? (
                        <Text variant="footnote" tone="muted" style={styles.note}>
                            {t('Could not refresh. Showing the last results.')}
                        </Text>
                    ) : null}

                    <Card padded style={styles.card} testID="settings-backups-status">
                        <View style={styles.head}>
                            <Dot tone={details.dot} size={8} />
                            <Text variant="body" weight="semibold" style={styles.headline}>
                                {details.headline}
                            </Text>
                        </View>

                        <View style={styles.rows}>
                            <Row label="Last backup" value={details.last} />
                            <Row label="Off-site copy" value={details.offsite} />
                        </View>
                    </Card>

                    {details.note ? (
                        <Text variant="footnote" tone="muted" style={styles.note}>
                            {details.note}
                        </Text>
                    ) : null}

                    {onChangeAccount ? (
                        <Button
                            label="Change account"
                            variant="secondary"
                            size="md"
                            onPress={onChangeAccount}
                            style={styles.change}
                            testID="settings-backups-change"
                        />
                    ) : null}
                </View>
            ) : null}
        </Pane>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    const t = useT();
    return (
        <View style={styles.row}>
            <Text variant="subhead" tone="muted">
                {t(label)}
            </Text>
            <Text variant="subhead" weight="semibold" numberOfLines={1} style={styles.value}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: space[2] },
    card: { gap: space[3] },
    head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    headline: { flex: 1, minWidth: 0 },
    rows: {
        gap: space[2],
        paddingTop: space[3],
        borderTopWidth: 1,
        borderTopColor: color.hair,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
    value: { flexShrink: 1 },
    note: { paddingHorizontal: space[0.5] },
    change: { alignSelf: 'flex-start', marginTop: space[2] },
});
