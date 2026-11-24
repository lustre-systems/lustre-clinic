import { PIASTRES_PER_POUND, type Tooth } from '@lustre/shared';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { formatMoney } from '../../../components/domain';
import {
    Button,
    Callout,
    Chevron,
    duration,
    Textarea,
    Toast,
    useKeyboardHeight,
} from '../../../components/ui';
import { useLocale, useT } from '../../../i18n';
import { border, color, font, radius, size, space, Text, type } from '../../../theme';
import { type Standing, standingFor } from '../chair';
import {
    type Appointment,
    amend,
    api,
    arrive,
    useGeneralClinic,
    useLocalMutation,
    useLocalQuery,
    type Visit,
} from '../data';
import { describeError } from '../errors';
import { discountPercent, formatAmount, poundsEntry } from '../money';
import { noteChanged, noteDraft, noteValue } from '../notes';
import {
    asksTooth,
    chargeableTotal,
    checkupIsWaived,
    headingOf,
    toothGroupsOf,
    toothPosition,
} from '../procedures';
import { dateKey, dayOfMonth, formatLongDate, formatTime12, monthShort, todayKey } from '../time';
import { PlusIcon, XIcon } from './icons';
import { type NextDraft, NextProcedureBox } from './NextProcedureBox';
import { type PickedProcedure, ProcedureSheet } from './ProcedureSheet';
import { ToothSheet } from './ToothSheet';
import { VisitStatusChip, visitState } from './VisitStatusChip';

type DraftLine = {
    id: string;
    procedureId: string;
    name: string;
    variant: string | null;
    tooth: Tooth | null;
    unitPrice: number | null;
    quantity: number;
    isCheckup: boolean;
};

const TOTAL: Record<Standing | 'arriving', string> = {
    arriving: 'Estimated total',
    waiting: 'Estimated total',
    chair: 'Running total',
    desk: 'Running total',
    finished: 'Total',
};

export type VisitScreenProps = {
    appointment: Appointment;
    visit?: Visit;
    mode: 'arrival' | 'checkout';
    standing?: Standing;
    onBack: () => void;
    onConfirm: (visit: Visit) => void;
    onNoteSaved?: (note: string | null) => void;
    onSentToDesk?: (message: string) => void;
    finishing?: boolean;
};

type Asking =
    | null
    | { step: 'tooth' }
    | { step: 'procedure'; tooth: Tooth | null }
    | { step: 'toothFor'; picked: PickedProcedure };

function seed(appointment: Appointment, visit: Visit | undefined): DraftLine[] {
    if (visit) {
        return visit.procedures.map((line) => ({
            id: line.id,
            procedureId: line.procedureId,
            name: line.name,
            variant: null,
            tooth: line.tooth,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            isCheckup: line.isCheckup,
        }));
    }

    return appointment.procedures.map((line) => ({
        id: line.id,
        procedureId: line.procedureId,
        name: line.name,
        variant: null,
        tooth: line.tooth,
        unitPrice: null,
        quantity: line.quantity,
        isCheckup: false,
    }));
}

export function VisitScreen({
    appointment,
    visit,
    mode,
    standing,
    onBack,
    onConfirm,
    onNoteSaved,
    onSentToDesk,
    finishing = false,
}: VisitScreenProps) {
    const t = useT();
    const locale = useLocale();
    const keyboard = useKeyboardHeight();
    const [lines, setLines] = useState<DraftLine[]>(() => seed(appointment, visit));
    const [next, setNext] = useState<NextDraft[]>(() =>
        (visit?.nextProcedures ?? []).map((line) => ({ ...line, variant: null })),
    );
    const [target, setTarget] = useState<'line' | { next: number | null }>('line');
    const [note, setNote] = useState(() => noteDraft(appointment.note));
    const [asking, setAsking] = useState<Asking>(null);
    const [collapsed, setCollapsed] = useState<readonly string[]>([]);
    const [toast, setToast] = useState<string | null>(null);
    const [edited, setEdited] = useState(false);

    const catalogue = useLocalQuery('procedure-tree', api.procedureTree);
    const general = useGeneralClinic();
    const price = useLocalMutation(amend);
    const checkIn = useLocalMutation(arrive);
    const sendToDesk = useLocalMutation(api.awaitPayment);

    const acting = useRef<'confirm' | 'desk'>('confirm');

    const prices = useMemo(() => {
        const map = new Map<string, number>();
        for (const category of catalogue.data ?? []) {
            map.set(category.id, category.defaultPrice);
            for (const child of category.children) map.set(child.id, child.defaultPrice);
        }
        return map;
    }, [catalogue.data]);

    const checkupIds = useMemo(() => {
        const ids = new Set<string>();
        for (const category of catalogue.data ?? []) {
            for (const row of category.selectable ? [category] : category.children) {
                if (row.isCheckup) ids.add(row.id);
            }
        }
        return ids;
    }, [catalogue.data]);

    const priceOf = (line: DraftLine): number => line.unitPrice ?? prices.get(line.procedureId) ?? 0;
    const percentOffDefault = (line: DraftLine): number | null =>
        discountPercent(prices.get(line.procedureId) ?? 0, priceOf(line));
    const isCheckupLine = (line: DraftLine): boolean => line.isCheckup || checkupIds.has(line.procedureId);
    const priced = (rows: readonly DraftLine[]) =>
        rows.map((line) => ({
            unitPrice: priceOf(line),
            quantity: line.quantity,
            isCheckup: isCheckupLine(line),
        }));

    const groups = toothGroupsOf(lines);
    const waived = checkupIsWaived(priced(lines));
    const subtotalOf = (rows: readonly DraftLine[]): number => chargeableTotal(priced(rows), waived);

    const total = subtotalOf(lines);
    const empty = lines.length === 0;

    const where = mode === 'arrival' ? 'arriving' : (standing ?? standingFor(appointment, todayKey()));
    const inChair = where === 'chair';
    const planning = where === 'arriving' || where === 'waiting';

    function startAdding(to: 'line' | { next: number | null } = 'line') {
        setTarget(to);
        setAsking(
            asksTooth(catalogue.data, general) ? { step: 'tooth' } : { step: 'procedure', tooth: null },
        );
    }

    function askProcedure(tooth: Tooth | null, afterSheet: boolean) {
        if (!afterSheet) {
            setTarget('line');
            setAsking({ step: 'procedure', tooth });
            return;
        }
        setAsking(null);
        setTimeout(() => setAsking({ step: 'procedure', tooth }), duration.sheet);
    }

    function pick(tooth: Tooth | null, picked: PickedProcedure) {
        if (tooth === null && picked.needsTooth) {
            setAsking(null);
            setTimeout(() => setAsking({ step: 'toothFor', picked }), duration.sheet);
            return;
        }
        add(tooth, picked);
    }

    function add(tooth: Tooth | null, picked: PickedProcedure) {
        if (target !== 'line') {
            const draft = {
                procedureId: picked.procedureId,
                name: picked.name,
                variant: picked.variant,
                tooth,
            };
            setNext((current) => {
                const others = current.filter((_, i) => i !== target.next);
                if (
                    others.some((row) => row.procedureId === draft.procedureId && row.tooth === draft.tooth)
                ) {
                    return others.length === current.length ? current : others;
                }
                return target.next === null
                    ? [...current, draft]
                    : current.map((row, i) => (i === target.next ? draft : row));
            });
            setAsking(null);
            return;
        }
        setEdited(true);
        setLines((current) => [
            ...current,
            {
                id: `draft-${Date.now()}-${current.length}`,
                procedureId: picked.procedureId,
                name: picked.name,
                variant: picked.variant,
                tooth,
                unitPrice: picked.price,
                quantity: 1,
                isCheckup: false,
            },
        ]);
        setAsking(null);
    }

    function remove(id: string) {
        setEdited(true);
        setLines((current) => current.filter((line) => line.id !== id));
    }

    function reprice(id: string, entry: string) {
        setEdited(true);
        const pounds = Number(poundsEntry(entry)) || 0;
        setLines((current) =>
            current.map((line) =>
                line.id === id ? { ...line, unitPrice: pounds * PIASTRES_PER_POUND } : line,
            ),
        );
    }

    function toggle(key: string) {
        setCollapsed((current) =>
            current.includes(key) ? current.filter((row) => row !== key) : [...current, key],
        );
    }

    const written = () =>
        lines.map((line) => ({
            procedureId: line.procedureId,
            quantity: line.quantity,
            unitPrice: priceOf(line),
            tooth: line.tooth,
        }));

    const nextPatch = () => {
        const was = visit?.nextProcedures ?? [];
        const same =
            was.length === next.length &&
            was.every((row, i) => row.procedureId === next[i]?.procedureId && row.tooth === next[i]?.tooth);
        return same ? undefined : next.map((row) => ({ procedureId: row.procedureId, tooth: row.tooth }));
    };

    const notePatch = (): string | null | undefined =>
        noteChanged(appointment.note, note) ? noteValue(note) : undefined;

    function save(then: (priced: Visit) => void) {
        if (empty && !planning) {
            setToast('Add at least one procedure before continuing');
            return;
        }
        if (!visit) return;

        const savedNote = notePatch();

        price.mutate(
            {
                visitId: visit.id,
                appointmentId: appointment.id,
                closed: visit.completedAt !== null,
                procedures: written(),
                note: savedNote,
                nextProcedures: nextPatch(),
            },
            {
                onSuccess: (priced) => {
                    if (savedNote !== undefined) onNoteSaved?.(savedNote);
                    then(priced);
                },
            },
        );
    }

    function confirm() {
        acting.current = 'confirm';
        if (mode === 'checkout') {
            save(onConfirm);
            return;
        }

        const savedNote = notePatch();

        checkIn.mutate(
            { appointmentId: appointment.id, procedures: written(), edited, note: savedNote },
            {
                onSuccess: (created) => {
                    if (savedNote !== undefined) onNoteSaved?.(savedNote);
                    onConfirm(created);
                },
            },
        );
    }

    function handToDesk() {
        acting.current = 'desk';
        save(() =>
            sendToDesk.mutate(appointment.id, {
                onSuccess: () =>
                    onSentToDesk?.(
                        t('{name} sent to the desk · {amount} to pay', {
                            name: appointment.patient.name,
                            amount: formatMoney(total),
                        }),
                    ),
            }),
        );
    }

    const writeError = price.error ?? checkIn.error ?? sendToDesk.error;
    const failure = writeError ? describeError(writeError, 'check-out') : null;
    const writing = price.pending || checkIn.pending || sendToDesk.pending;
    const confirming = acting.current === 'confirm' && (price.pending || checkIn.pending);
    const handingOver = acting.current === 'desk' && (price.pending || sendToDesk.pending);
    const day = dateKey(appointment.startsAt);

    return (
        <View style={styles.screen} testID="visit-screen">
            <View style={styles.topbar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to the day"
                    disabled={writing}
                    onPress={onBack}
                    style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
                >
                    <Chevron direction="back" size={10} tone="ink" />
                </Pressable>
                <Text variant="eyebrow" tone="muted">
                    {t('VISIT')}
                </Text>
            </View>

            <View style={styles.identity}>
                <View style={styles.tile}>
                    <Text variant="title3" script="sans" weight="semibold" tone="inverse">
                        {dayOfMonth(day)}
                    </Text>
                    <Text variant="tag" tone="inverse" style={styles.tileMonth}>
                        {monthShort(day)}
                    </Text>
                </View>

                <View style={styles.who}>
                    <Text variant="title2" weight="bold" numberOfLines={2}>
                        {appointment.patient.name}
                    </Text>
                    <Text variant="subhead" tone="muted">
                        {`${formatLongDate(day)} · ${formatTime12(appointment.startsAt, locale)}`}
                    </Text>
                    <View style={styles.chipRow}>
                        <VisitStatusChip state={visitState(where, visit?.completedAt != null)} />
                    </View>
                </View>
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.body}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.sectionHead}>
                    <Text variant="eyebrow" tone="muted">
                        {t(planning ? 'WHAT THEY ARE HERE FOR' : 'WHAT WAS DONE')}
                    </Text>
                    <Text variant="footnote" tone="muted">
                        {t(lines.length === 1 ? '{count} procedure' : '{count} procedures', {
                            count: lines.length,
                        })}
                    </Text>
                </View>

                {empty ? (
                    <View style={styles.emptyState}>
                        <View style={styles.ring}>
                            <PlusIcon size={22} stroke={color.ink} width={2.2} />
                        </View>
                        <Text variant="headline" weight="semibold">
                            {t(planning ? 'Nothing planned' : 'Nothing recorded yet')}
                        </Text>
                        <Text variant="subhead" tone="muted" style={styles.emptyBody}>
                            {t(
                                planning
                                    ? 'This booking came with no procedures. Add one now, or leave it to be decided in the chair.'
                                    : 'Add the procedure the doctor performed — you can come back and edit this at any time.',
                            )}
                        </Text>
                        <Button
                            label="Add a procedure"
                            onPress={() => startAdding()}
                            style={styles.emptyCta}
                            testID="visit-add-first"
                        />
                    </View>
                ) : (
                    <View style={styles.groups}>
                        {groups.map((group) => {
                            const key = group.tooth ?? 'none';
                            const open = !collapsed.includes(key);
                            const position = toothPosition(group.tooth, general);

                            return (
                                <View key={key} style={styles.group}>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded: open }}
                                        accessibilityLabel={
                                            position
                                                ? t('{position}, {count} procedures', {
                                                      position,
                                                      count: group.items.length,
                                                  })
                                                : t('{count} procedures', { count: group.items.length })
                                        }
                                        onPress={() => toggle(key)}
                                        style={({ pressed }) => [styles.groupHead, pressed && styles.pressed]}
                                    >
                                        <View style={[styles.badge, !group.tooth && styles.badgeNone]}>
                                            <Text
                                                variant="subhead"
                                                weight="bold"
                                                tone={group.tooth ? 'inverse' : 'muted'}
                                            >
                                                {group.tooth ?? '—'}
                                            </Text>
                                        </View>

                                        <Text
                                            variant="subhead"
                                            weight="medium"
                                            tone="muted"
                                            numberOfLines={1}
                                            style={styles.grow}
                                        >
                                            {position}
                                        </Text>

                                        <Text variant="callout" script="mono" weight="bold">
                                            {formatAmount(subtotalOf(group.items))}
                                        </Text>

                                        <Chevron
                                            direction={open ? 'down' : 'forward'}
                                            size={9}
                                            tone="muted"
                                        />
                                    </Pressable>

                                    {open ? (
                                        <View>
                                            {group.items.map((line) => (
                                                <View key={line.id} style={styles.line}>
                                                    <View style={styles.grow}>
                                                        <Text variant="callout" weight="semibold">
                                                            {line.quantity > 1
                                                                ? `${line.name} × ${line.quantity}`
                                                                : line.name}
                                                        </Text>
                                                        {line.variant ? (
                                                            <Text
                                                                variant="caption"
                                                                tone="muted"
                                                                style={styles.variant}
                                                            >
                                                                {line.variant}
                                                            </Text>
                                                        ) : null}
                                                        {percentOffDefault(line) !== null ? (
                                                            <Text
                                                                variant="caption"
                                                                tone="muted"
                                                                style={styles.variant}
                                                                testID={`visit-line-discount-${line.id}`}
                                                            >
                                                                {t('{percent}% off the usual {price}', {
                                                                    percent: percentOffDefault(line) ?? 0,
                                                                    price: formatMoney(
                                                                        prices.get(line.procedureId) ?? 0,
                                                                    ),
                                                                })}
                                                            </Text>
                                                        ) : null}
                                                        {waived && isCheckupLine(line) ? (
                                                            <Text
                                                                variant="caption"
                                                                tone="muted"
                                                                style={styles.variant}
                                                            >
                                                                {t('Not charged — other work was done')}
                                                            </Text>
                                                        ) : null}
                                                    </View>

                                                    <Text variant="eyebrow" tone="muted">
                                                        {t('EGP')}
                                                    </Text>
                                                    <TextInput
                                                        value={String(
                                                            Math.round(priceOf(line) / PIASTRES_PER_POUND),
                                                        )}
                                                        onChangeText={(entry) => reprice(line.id, entry)}
                                                        keyboardType="decimal-pad"
                                                        selectTextOnFocus
                                                        accessibilityLabel={t('Cost for {name}', {
                                                            name: line.name,
                                                        })}
                                                        style={styles.cost}
                                                    />

                                                    <Pressable
                                                        accessibilityRole="button"
                                                        accessibilityLabel={t('Remove {name}', {
                                                            name: line.name,
                                                        })}
                                                        hitSlop={8}
                                                        onPress={() => remove(line.id)}
                                                        style={({ pressed }) => [
                                                            styles.kill,
                                                            pressed && styles.killPressed,
                                                        ]}
                                                    >
                                                        <XIcon size={14} stroke={color.muted} />
                                                    </Pressable>
                                                </View>
                                            ))}

                                            {group.tooth ? (
                                                <Pressable
                                                    accessibilityRole="button"
                                                    onPress={() => askProcedure(group.tooth, false)}
                                                    style={({ pressed }) => [
                                                        styles.groupAdd,
                                                        pressed && styles.pressed,
                                                    ]}
                                                >
                                                    <View style={styles.groupAddGlyph}>
                                                        <PlusIcon size={12} stroke={color.ink2} />
                                                    </View>
                                                    <Text variant="footnote" weight="semibold" tone="ink2">
                                                        {t('Add to {tooth}', { tooth: group.tooth })}
                                                    </Text>
                                                </Pressable>
                                            ) : null}
                                        </View>
                                    ) : null}
                                </View>
                            );
                        })}
                    </View>
                )}

                {empty ? null : (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => startAdding()}
                        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                        testID="visit-add"
                    >
                        <View style={styles.addGlyph}>
                            <PlusIcon size={13} stroke={color.inverse} />
                        </View>
                        <Text variant="subhead" weight="semibold" tone="ink2">
                            {t('Add procedure')}
                        </Text>
                    </Pressable>
                )}

                {mode === 'checkout' ? (
                    <NextProcedureBox
                        next={next.map((row) => {
                            const found = row.variant
                                ? null
                                : headingOf(row.procedureId, catalogue.data ?? []);
                            return found ? { ...row, name: found.name, variant: found.variant } : row;
                        })}
                        booked={nextPatch() === undefined && (visit?.nextAppointmentId ?? null) !== null}
                        onAdd={() => startAdding({ next: null })}
                        onChange={(i) => startAdding({ next: i })}
                        onRemove={(i) => setNext((current) => current.filter((_, at) => at !== i))}
                    />
                ) : null}

                <View style={styles.noteSection}>
                    <View style={styles.sectionHead}>
                        <Text variant="eyebrow" tone="muted">
                            {t('NOTE')}
                        </Text>
                    </View>
                    <View style={styles.noteField}>
                        <Textarea
                            value={note}
                            onChangeText={setNote}
                            placeholder={t('Anything the doctor should know.')}
                            accessibilityLabel={t('Visit note')}
                            testID="visit-note"
                        />
                    </View>
                </View>

                <View style={[styles.total, empty && styles.totalIdle]}>
                    <View style={styles.totalLabel}>
                        <View style={[styles.totalDot, empty ? styles.dotNeutral : styles.dotRunning]} />
                        <Text variant="subhead" tone="muted">
                            {t(empty ? 'Total' : TOTAL[where])}
                        </Text>
                    </View>
                    <Text variant="headline" script="mono" weight="bold" tone={empty ? 'muted' : 'due'}>
                        {empty ? '—' : formatMoney(total)}
                    </Text>
                </View>
            </ScrollView>

            {failure ? (
                <View style={styles.notice}>
                    <Callout tone="warning" title={failure.title}>
                        {failure.body ?? ''}
                    </Callout>
                </View>
            ) : null}

            <View style={[styles.bar, { paddingBottom: Math.max(space[4], keyboard) }]}>
                {finishing ? (
                    <View style={styles.primaryAction}>
                        <Button
                            label="Save and send to desk"
                            block
                            loading={handingOver}
                            onPress={handToDesk}
                            testID="visit-save-and-finish"
                        />
                    </View>
                ) : (
                    <>
                        {inChair ? (
                            <View style={styles.secondaryAction}>
                                <Button
                                    label="Send to desk"
                                    variant="ghost"
                                    block
                                    loading={handingOver}
                                    disabled={confirming}
                                    onPress={handToDesk}
                                    testID="visit-send-to-desk"
                                />
                            </View>
                        ) : null}
                        <View style={styles.primaryAction}>
                            <Button
                                label="Confirm"
                                block
                                loading={confirming}
                                disabled={handingOver}
                                onPress={confirm}
                                testID="visit-confirm"
                            />
                        </View>
                    </>
                )}
            </View>

            <ToothSheet
                visible={asking?.step === 'tooth' || asking?.step === 'toothFor'}
                required={
                    asking?.step === 'toothFor' ? (asking.picked.variant ?? asking.picked.name) : undefined
                }
                onClose={() => setAsking(null)}
                onPick={(tooth) => {
                    if (asking?.step === 'toothFor') {
                        add(tooth, asking.picked);
                        return;
                    }
                    askProcedure(tooth, true);
                }}
            />

            <ProcedureSheet
                visible={asking?.step === 'procedure'}
                onClose={() => setAsking(null)}
                onPick={(picked) => pick(asking?.step === 'procedure' ? asking.tooth : null, picked)}
                categories={catalogue.data ?? []}
                loading={catalogue.status === 'loading'}
                error={catalogue.status === 'error' ? catalogue.error : null}
                onRetry={catalogue.refetch}
                tooth={asking?.step === 'procedure' ? asking.tooth : null}
            />

            <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },

    topbar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingHorizontal: space[4],
        paddingTop: space[1.5],
        paddingBottom: space[0.5],
    },
    back: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    backPressed: { backgroundColor: color.surface2 },

    identity: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3.5],
        paddingHorizontal: size.gutter,
        paddingTop: space[3.5],
        paddingBottom: space[4.5],
    },
    tile: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.xl2,
        backgroundColor: color.ink,
    },
    tileMonth: { opacity: 0.62 },
    who: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
    chipRow: { flexDirection: 'row', marginTop: space[0.5] },

    totalLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2.5] },
    totalDot: { width: 7, height: 7, borderRadius: radius.full },
    dotNeutral: { backgroundColor: color.line },
    dotRunning: { backgroundColor: color.due },

    scroll: { flex: 1 },
    body: { paddingBottom: space[8] },

    sectionHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: size.gutter,
        paddingTop: space[4],
        paddingBottom: space[1.5],
    },

    emptyState: {
        alignItems: 'center',
        gap: space[1.5],
        paddingHorizontal: size.gutter,
        paddingTop: space[8],
        paddingBottom: space[7],
    },
    ring: {
        width: 52,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.surface2,
        marginBottom: space[3.5],
    },
    emptyBody: { textAlign: 'center', maxWidth: 240, marginBottom: space[3.5] },
    emptyCta: { alignSelf: 'center' },

    groups: { gap: space[3], paddingHorizontal: size.gutter, paddingTop: space[0.5] },
    group: {
        borderRadius: radius.xl2,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
        overflow: 'hidden',
    },
    groupHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: 54,
        paddingStart: space[2.5],
        paddingEnd: space[3.5],
    },
    badge: {
        minWidth: 46,
        height: 37,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[1.5],
        borderRadius: radius.md,
        backgroundColor: color.ink,
    },
    badgeNone: {
        backgroundColor: color.surface2,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
    },
    grow: { flex: 1, minWidth: 0 },

    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingStart: space[3.5],
        paddingEnd: space[2.5],
        paddingVertical: space[2],
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
    },
    variant: { marginTop: space[1] },
    cost: {
        minWidth: 56,
        paddingVertical: space[1],
        textAlign: 'right',
        ...type.body,
        fontFamily: font.mono.medium,
        color: color.ink,
    },
    kill: {
        width: 26,
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
    },
    killPressed: { backgroundColor: color.dueSoft },

    groupAdd: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        minHeight: 42,
        paddingHorizontal: space[3.5],
        borderTopWidth: border.hair,
        borderTopColor: color.line,
        borderStyle: 'dashed',
    },
    groupAddGlyph: {
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },

    add: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: 44,
        marginHorizontal: size.gutter,
        marginTop: space[3],
        marginBottom: space[1],
        paddingHorizontal: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    addGlyph: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.ink,
    },

    noteSection: { gap: space[2] },
    noteField: { paddingHorizontal: size.gutter },
    total: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: size.gutter,
        marginTop: space[3.5],
        paddingVertical: space[3.5],
        paddingHorizontal: space[4],
        borderRadius: radius.xl,
        backgroundColor: color.surface2,
    },
    totalIdle: { opacity: 0.5 },

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    bar: {
        flexDirection: 'row',
        gap: space[2],
        paddingHorizontal: size.gutter,
        paddingTop: space[3.5],
        backgroundColor: color.canvas,
    },
    secondaryAction: { flex: 1 },
    primaryAction: { flex: 1 },
    pressed: { opacity: 0.72 },
});
