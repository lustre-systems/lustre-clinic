/**
 * Today and tomorrow as the server last told this phone, under the offline
 * card. Read-only by construction: no row presses, no FAB, no status that can
 * be changed — everything here may already be wrong, so the list says when it
 * was taken before it says anything else, and the rows are drawn in the
 * day's own `AppointmentRow` shape but without its chevron, so it does not
 * read as the live day with a banner over it.
 *
 * The phone number is on every row because the reason to open this during a
 * power cut is usually to ring someone.
 */
import { StyleSheet, View } from 'react-native';
import { serverAddresses } from '../../../api';
import { formatStamp, phoneText, StatusPill, TimeValue } from '../../../components/domain';
import { SectionLabel } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { type SavedRow, type SavedSchedule, serverIdentity, usableSchedule } from '../savedSchedule';
import { useStoredSchedule } from '../savedScheduleStore';
import { dateKey, formatDate, minutesOfDay, relativeDayLabel, todayKey } from '../time';

export function useSavedSchedule(): SavedSchedule | null {
    const raw = useStoredSchedule();
    return usableSchedule(raw, serverIdentity(serverAddresses()), todayKey());
}

export function SavedScheduleList({ schedule }: { schedule: SavedSchedule }) {
    const t = useT();
    const today = todayKey();
    const savedOn = dateKey(schedule.savedAt);
    const time = formatStamp(schedule.savedAt);
    const branchName = new Map(schedule.branches.map((branch) => [branch.id, branch.name]));
    const manyBranches = schedule.branches.length > 1;

    return (
        <View style={styles.root} testID="saved-schedule">
            <View style={styles.notice}>
                <Text variant="subhead" weight="semibold">
                    {savedOn === today
                        ? t('Saved at {time} — read only', { time })
                        : t('Saved {day} at {time} — read only', { day: formatDate(savedOn), time })}
                </Text>
                <Text variant="footnote" tone="muted">
                    {t('Anything booked or changed since then is not here. Write today’s changes on paper.')}
                </Text>
            </View>

            {schedule.days.map((day) => (
                <View key={day.date} style={styles.day}>
                    <SectionLabel inset={false} count={day.rows.length}>
                        {relativeDayLabel(day.date, today)}
                    </SectionLabel>
                    {day.rows.length === 0 ? (
                        <Text variant="subhead" tone="muted">
                            {t('Nothing booked')}
                        </Text>
                    ) : (
                        day.rows.map((row) => (
                            <Row
                                key={row.id}
                                row={row}
                                branch={manyBranches ? branchName.get(row.branchId) : undefined}
                            />
                        ))
                    )}
                </View>
            ))}
        </View>
    );
}

function Row({ row, branch }: { row: SavedRow; branch: string | undefined }) {
    const t = useT();
    const settled = row.status === 'done' || row.status === 'no_show';

    return (
        <View style={[styles.row, settled && styles.settled]} accessible>
            <View style={styles.time}>
                <TimeValue minutes={minutesOfDay(row.startsAt)} weight="medium" />
            </View>
            <View style={styles.body}>
                <Text variant="headline" weight="semibold" numberOfLines={1}>
                    {row.name}
                </Text>
                {row.summary ? (
                    <Text variant="subhead" tone="muted" numberOfLines={1}>
                        {row.summary}
                    </Text>
                ) : null}
                <View style={styles.meta}>
                    <Text variant="subhead" tone="muted">
                        {phoneText(row.phone)}
                    </Text>
                    <Text variant="subhead" tone="muted">
                        {t('{minutes} min', { minutes: row.durationMinutes })}
                    </Text>
                    {branch ? (
                        <Text variant="subhead" tone="muted">
                            {branch}
                        </Text>
                    ) : null}
                    <StatusPill status={row.status} animated={false} />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { alignSelf: 'stretch', gap: space[5] },
    notice: {
        gap: space[1],
        padding: space[3],
        borderRadius: radius.xl,
        backgroundColor: color.dueSoft,
    },
    day: { gap: space[2] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row,
        padding: space[3],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
    },
    settled: { opacity: 0.72 },
    time: { width: 80, flexShrink: 0 },
    body: { flex: 1, gap: space[1] },
    meta: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
});
