/**
 * The "Done" view: what this phone did, newest first, a card per day.
 *
 * Each line is the kind of action, when, and the patient with one detail. A
 * line opens what it was about — the booking, the visit, the record; a
 * cancellation has nothing left to open and is drawn without a chevron and
 * without a press.
 */
import { seesPayments } from '@lustre/shared';
import { useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { serverToday } from '../api/serverClock';
import { GLYPH, type Glyph } from '../components/domain';
import { Chevron, EmptyState, SectionLabel } from '../components/ui';
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

export type LastDoneListProps = {
    onOpen: (target: LastDoneTarget) => void;
};

export function LastDoneList({ onOpen }: LastDoneListProps) {
    const t = useT();
    const locale = useLocale();
    const { granted } = useRole();
    const state = useSyncExternalStore(lastDone.subscribe, lastDone.getSnapshot);

    const now = Date.now();
    const entries = state.entries.filter((entry) => now - entry.at < MAX_AGE_MS);
    const showMoney = seesPayments(granted);

    if (entries.length === 0) {
        return (
            <View style={styles.empty}>
                <EmptyState
                    icon={<GLYPH.lastDone size={22} color={color.ink2} strokeWidth={2} />}
                    title="Nothing yet"
                    body="What you do on this phone shows up here."
                    weight="panel"
                />
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.content} testID="last-done-list">
            <Text variant="footnote" tone="muted" style={styles.caption}>
                {t('On this phone')}
            </Text>
            {byDay(entries).map((group) => (
                <View key={group.key} style={styles.group}>
                    <SectionLabel>{dayLabel(group.key)}</SectionLabel>
                    <View style={styles.card}>
                        {group.entries.map((entry, index) => (
                            <Line
                                key={entry.id}
                                entry={entry}
                                first={index === 0}
                                title={t(TITLE[entry.kind])}
                                when={whenText(entry.at, now, locale)}
                                sub={subline(entry, locale, showMoney)}
                                onOpen={onOpen}
                            />
                        ))}
                    </View>
                </View>
            ))}
        </ScrollView>
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
    first,
    title,
    when,
    sub,
    onOpen,
}: {
    entry: LastDoneEntry;
    first: boolean;
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

    const line = [styles.line, !first && styles.ruled];

    if (!target) {
        return (
            <View style={line} accessible testID={`last-done-${entry.kind}`}>
                {body}
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(target)}
            style={({ pressed }) => [line, pressed && styles.pressed]}
            testID={`last-done-${entry.kind}`}
        >
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    empty: { paddingHorizontal: size.gutter, paddingTop: space[4] },
    content: { paddingBottom: space[12], gap: space[3] },
    caption: { paddingHorizontal: size.gutter },
    group: { gap: space[1.5] },
    card: {
        marginHorizontal: size.bleed,
        paddingHorizontal: space[4],
        backgroundColor: color.surface,
        borderRadius: radius.xl2,
    },
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.control + space[2],
        paddingVertical: space[2.5],
    },
    ruled: { borderTopWidth: border.hair, borderTopColor: color.hair },
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
