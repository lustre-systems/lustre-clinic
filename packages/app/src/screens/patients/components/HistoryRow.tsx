import { clinicWallClock } from '@lustre/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { MoneyValue, StatusBadge } from '../../../components/domain';
import { useLocale, useT } from '../../../i18n';
import { border, color, size, space, Text } from '../../../theme';
import type { HistoryProcedure, PatientHistoryEntry } from '../data/types';

export type HistoryRowProps = {
    entry: PatientHistoryEntry;
    inChair?: boolean;
    onOpen?: (entry: PatientHistoryEntry) => void;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CARRIED_OVER = { label: 'Carried over', tone: 'muted' } as const;

const IMPORTED = { label: 'Old record', tone: 'muted' } as const;

export function HistoryRow({ entry, inChair, onOpen }: HistoryRowProps) {
    const t = useT();
    const locale = useLocale();
    const { day, month } = stamp(entry.startsAt);
    const carried = entry.isOpeningBalance;
    const badge = carried ? (
        <StatusBadge {...CARRIED_OVER} />
    ) : entry.isImported ? (
        <StatusBadge {...IMPORTED} />
    ) : (
        <StatusBadge status={entry.status} inChair={inChair} />
    );
    const came = entry.visitId !== null;
    const owed = entry.balance ?? 0;
    const due = owed > 0;

    const openable = ((came && !carried) || entry.status === 'booked') && onOpen !== undefined;

    const undated = entry.isImported && entry.dateUnknown;

    return (
        <Pressable
            accessibilityRole={openable ? 'button' : undefined}
            disabled={!openable}
            onPress={openable ? () => onOpen?.(entry) : undefined}
            style={({ pressed }) => [styles.row, pressed && openable && styles.pressed]}
            testID={`history-row-${entry.appointmentId}`}
        >
            <View style={styles.stamp}>
                {undated ? (
                    <Text variant="callout" script="mono" weight="bold" tone="muted">
                        —
                    </Text>
                ) : (
                    <>
                        <Text variant="callout" script="mono" weight="bold">
                            {day}
                        </Text>
                        <Text variant="tag" tone="muted">
                            {locale === 'ar' ? t(month) : month.toUpperCase()}
                        </Text>
                    </>
                )}
            </View>

            <View style={styles.body}>
                {carried ? (
                    <Text variant="callout" weight="bold" numberOfLines={2}>
                        {t('Opening balance')}
                    </Text>
                ) : (
                    <Work procedures={entry.procedures} />
                )}

                <View style={styles.meta}>{badge}</View>
            </View>

            <View style={styles.amounts}>
                {came && due ? (
                    <View style={styles.meaning}>
                        <MoneyValue
                            piastres={owed}
                            variant="callout"
                            weight="bold"
                            showCurrency={false}
                            tone="due"
                        />
                        <Text variant="caption" weight="bold" tone="due">
                            {t('due')}
                        </Text>
                    </View>
                ) : came && entry.chargedTotal !== null ? (
                    <MoneyValue
                        piastres={entry.chargedTotal}
                        variant="callout"
                        weight="bold"
                        showCurrency={false}
                        tone="ink"
                    />
                ) : null}
                <Meaning entry={entry} />
            </View>
        </Pressable>
    );
}

function Work({ procedures }: { procedures: HistoryProcedure[] }) {
    const t = useT();
    const [first, ...rest] = procedures;

    if (!first) {
        return (
            <Text variant="callout" weight="bold" tone="muted" numberOfLines={2}>
                {t('No procedures recorded')}
            </Text>
        );
    }

    return (
        <Text variant="callout" weight="bold" numberOfLines={2}>
            {first.tooth ? `${first.name} — ${first.tooth}` : first.name}
            {rest.length > 0 ? (
                <Text variant="subhead" tone="muted">
                    {'  '}
                    {rest.length === 1 ? t('+1 more') : t('+{count} more', { count: rest.length })}
                </Text>
            ) : null}
        </Text>
    );
}

function Meaning({ entry }: { entry: PatientHistoryEntry }) {
    const t = useT();
    if (entry.isImported) {
        return (
            <Text variant="caption" tone="muted" style={styles.importedNote}>
                {entry.dateUnknown ? t('Before migration') : t('From the old system')}
            </Text>
        );
    }

    if (entry.visitId === null) {
        if (entry.status === 'no_show') {
            return (
                <Text variant="caption" tone="muted">
                    {t('Did not attend')}
                </Text>
            );
        }
        if (entry.status === 'cancelled') {
            return (
                <Text variant="caption" tone="muted">
                    {t('Called off')}
                </Text>
            );
        }
        return null;
    }

    if (entry.balance === null) return null;

    if (entry.balance > 0) {
        return (
            <View style={styles.meaning}>
                <Text variant="caption" tone="muted">
                    {t('of')}
                </Text>
                <MoneyValue
                    piastres={entry.chargedTotal ?? 0}
                    variant="caption"
                    tone="muted"
                    showCurrency={false}
                />
            </View>
        );
    }

    return (
        <Text variant="caption" weight="medium" tone="success">
            {t('Paid in full')}
        </Text>
    );
}

function stamp(iso: string): { day: string; month: string } {
    const date = clinicWallClock(iso);
    return {
        day: String(date.day).padStart(2, '0'),
        month: MONTHS[date.month - 1] ?? '',
    };
}

const styles = StyleSheet.create({
    pressed: { backgroundColor: color.surface2 },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        paddingHorizontal: size.gutter,
        paddingVertical: space[2.5],
        borderBottomWidth: border.hair,
        borderBottomColor: color.line,
    },
    stamp: { width: 30, alignItems: 'center' },
    body: { flex: 1, alignItems: 'flex-start', gap: space[1] },
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
    amounts: { alignItems: 'flex-end', gap: space[0.5] },
    importedNote: { textAlign: 'right', maxWidth: 96 },
    meaning: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
});
