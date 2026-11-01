/**
 * "What you did — on this phone": the log, newest first, under a label per day.
 *
 * Each line is the kind of action, when, and the patient with one detail. A
 * line opens what it was about — the booking, the visit, the record — once the
 * sheet is off the screen (`useAfterSheet`); a cancellation has nothing left to
 * open and is drawn without a chevron and without a press.
 */
import { seesPayments } from '@lustre/shared';
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { serverToday } from '../api/serverClock';
import { GLYPH, type Glyph } from '../components/domain';
import { Chevron, EmptyState, SectionLabel, Sheet, useAfterSheet } from '../components/ui';
import { useLocale, useT } from '../i18n';
import { addDays, formatDate } from '../screens/day/time';
import { useRole } from '../shell/useRole';
import { border, color, radius, size, space, Text } from '../theme';
import { type LastDoneEntry, type LastDoneKind, type LastDoneTarget, targetOf } from './entry';
import { byDay, subline, TITLE, whenText } from './format';
import { lastDone, MAX_AGE_MS } from './store';

const KIND_GLYPH: Record<LastDoneKind, Glyph> = {
    book: GLYPH.book,
    move: GLYPH.reschedule,
    cancel: GLYPH.cancelAppointment,
    noShow: GLYPH.noShow,
    checkIn: GLYPH.enterDemo,
    finish: GLYPH.check,
    procedures: GLYPH.procedure,
    payment: GLYPH.pay,
    paymentFix: GLYPH.pay,
    addPatient: GLYPH.patient,
    editPatient: GLYPH.edit,
    oldVisit: GLYPH.oldVisit,
};

export type LastDoneSheetProps = {
    visible: boolean;
    onClose: () => void;
    onOpen: (target: LastDoneTarget) => void;
};

export function LastDoneSheet({ visible, onClose, onOpen }: LastDoneSheetProps) {
    const t = useT();
    const locale = useLocale();
    const { granted } = useRole();
    const state = useSyncExternalStore(lastDone.subscribe, lastDone.getSnapshot);
    const after = useAfterSheet();

    const now = Date.now();
    const entries = state.entries.filter((entry) => now - entry.at < MAX_AGE_MS);
    const showMoney = seesPayments(granted);

    function choose(target: LastDoneTarget) {
        after.after(() => onOpen(target));
        onClose();
    }

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            onClosed={after.closed}
            title="What you did"
            subtitle="On this phone"
            testID="last-done-sheet"
        >
            {entries.length === 0 ? (
                <EmptyState
                    icon={<GLYPH.lastDone size={22} color={color.ink2} strokeWidth={2} />}
                    title="Nothing yet"
                    body="What you do on this phone shows up here."
                    weight="panel"
                />
            ) : (
                byDay(entries).map((group) => (
                    <View key={group.key} style={styles.group}>
                        <SectionLabel inset={false}>{dayLabel(group.key)}</SectionLabel>
                        {group.entries.map((entry) => (
                            <Line
                                key={entry.id}
                                entry={entry}
                                title={t(TITLE[entry.kind])}
                                when={whenText(entry.at, now, locale)}
                                sub={subline(entry, locale, showMoney)}
                                onOpen={choose}
                            />
                        ))}
                    </View>
                ))
            )}
        </Sheet>
    );
}

/** Today and Yesterday by name, the date before that. `SectionLabel` localizes the names. */
function dayLabel(key: string): string {
    const today = serverToday();
    if (key === today) return 'Today';
    if (key === addDays(today, -1)) return 'Yesterday';
    return formatDate(key);
}

function Line({
    entry,
    title,
    when,
    sub,
    onOpen,
}: {
    entry: LastDoneEntry;
    title: string;
    when: string;
    sub: string;
    onOpen: (target: LastDoneTarget) => void;
}) {
    const target = targetOf(entry);
    const Glyph = KIND_GLYPH[entry.kind];

    const body = (
        <>
            <View style={styles.tile}>
                <Glyph size={17} color={color.ink2} strokeWidth={2} />
            </View>
            <View style={styles.text}>
                <View style={styles.top}>
                    <Text variant="callout" weight="semibold" numberOfLines={1} style={styles.title}>
                        {title}
                    </Text>
                    <Text variant="footnote" tone="muted">
                        {when}
                    </Text>
                </View>
                {sub ? (
                    <Text variant="footnote" tone="muted" numberOfLines={1}>
                        {sub}
                    </Text>
                ) : null}
            </View>
            <View style={styles.end}>{target ? <Chevron direction="forward" size={7} /> : null}</View>
        </>
    );

    if (!target) {
        return (
            <View style={styles.line} accessible testID={`last-done-${entry.kind}`}>
                {body}
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(target)}
            style={({ pressed }) => [styles.line, pressed && styles.pressed]}
            testID={`last-done-${entry.kind}`}
        >
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    group: { paddingTop: space[2] },
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.control + space[2],
        paddingVertical: space[2],
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
    },
    pressed: { opacity: 0.72 },
    tile: {
        width: 36,
        height: 36,
        borderRadius: radius.full,
        backgroundColor: color.surface2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: { flex: 1, gap: space[0.5] },
    top: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
    title: { flex: 1 },
    end: { width: space[3], alignItems: 'center' },
});
