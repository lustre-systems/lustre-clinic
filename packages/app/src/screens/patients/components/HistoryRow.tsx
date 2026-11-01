import { clinicWallClock } from '@lustre/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { MoneyValue, StatusBadge } from '../../../components/domain';
import { useLocale, useT } from '../../../i18n';
import { border, color, size, space, Text } from '../../../theme';
import type { HistoryProcedure, PatientHistoryEntry } from '../data/types';

export type HistoryRowProps = {
    entry: PatientHistoryEntry;
    /**
     * Whether this `checked_in` row heads today's arrival queue. The status is
     * the same for the chair and the waiting room, so only the queue can say
     * which. Absent means the queue is not known — still loading, or the read
     * failed — and the row says Checked in rather than guess either way.
     */
    inChair?: boolean;
    /**
     * Opens the visit behind a row that came, or the booking page for one still
     * `booked`. Absent leaves every row inert.
     */
    onOpen?: (entry: PatientHistoryEntry) => void;
};

// Title case, not the shouted form the stamp draws: the catalogue is keyed on
// the name as it is written, and the row upper-cases it for English at render.
// Arabic has no case, so it takes the translation as it comes.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Not a status the schema has — the row is `done`, and what happened is that nothing did. */
const CARRIED_OVER = { label: 'Carried over', tone: 'muted' } as const;

/** Work the old system recorded. It happened — somewhere else, before this app. */
const IMPORTED = { label: 'Old record', tone: 'muted' } as const;

export function HistoryRow({ entry, inChair, onOpen }: HistoryRowProps) {
    const t = useT();
    const locale = useLocale();
    const { day, month } = stamp(entry.startsAt);
    const carried = entry.isOpeningBalance;
    // Debt carried over from the old system has a visit behind it, because that
    // is the only place a balance can live (§10) — but nobody sat in the chair,
    // so it says what it is instead of borrowing the words for a visit. `Done`
    // under a `done` status on a day the clinic never saw them is the record
    // telling the desk something that did not happen.
    const badge = carried ? (
        <StatusBadge {...CARRIED_OVER} />
    ) : entry.isImported ? (
        <StatusBadge {...IMPORTED} />
    ) : (
        <StatusBadge status={entry.status} inChair={inChair} />
    );
    const came = entry.visitId !== null;
    // Null on a phone not shown payments: the row then shows the charge alone.
    const owed = entry.balance ?? 0;
    const due = owed > 0;

    // A row is a way into what it stands for: the visit behind a row that came,
    // or the booking itself while it is still to come. One with neither — a
    // cancellation, a no-show — has nothing behind it and stays inert rather
    // than offering a tap that goes nowhere. An opening balance has a visit,
    // but an empty one with no procedures on it, so there is nothing to open
    // either.
    const openable = ((came && !carried) || entry.status === 'booked') && onOpen !== undefined;

    // An imported row's date is the cutoff only because `starts_at` is NOT
    // NULL. Drawing it would be this record telling the desk a day the work was
    // done on, which nobody knows — so the stamp says nothing and the line
    // under the row says why.
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

/**
 * The first procedure in full, the rest counted and set quieter beside it. Two
 * teeth and a quantity do not fit a row on a phone, and the visit screen is
 * where the whole list belongs.
 */
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

/**
 * What the number above it means, or — where there is no number — what happened
 * instead. A row still to come says nothing: it has not happened, and "Booked"
 * is already on the pill.
 */
function Meaning({ entry }: { entry: PatientHistoryEntry }) {
    const t = useT();
    // Work the old system recorded. There is no money column on it at all — no
    // visit, so nothing to charge, owe or pay — and the line under the empty
    // column is the only thing that has to say so.
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

    // Withheld on a phone not shown payments: the charge above is all the row
    // says, and nothing about whether it was paid.
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
    // Wraps, so a long procedure name pushing the pill wide drops the ref to its
    // own line rather than squeezing it — a half-shown ref is worse than none.
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
    amounts: { alignItems: 'flex-end', gap: space[0.5] },
    // The column is empty above it, so the note wraps to two short lines on a
    // narrow phone rather than pushing the row's body out of shape.
    importedNote: { textAlign: 'right', maxWidth: 96 },
    meaning: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
});
