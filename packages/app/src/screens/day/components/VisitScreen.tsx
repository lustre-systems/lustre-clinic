/**
 * What was done — `check-in.html`, the screen that stands between checking a
 * patient in and taking their money. It is clinical only: procedures, teeth and
 * prices. Nothing on it is paid for; `VisitPaymentScreen` is the next step and
 * the only place money changes hands.
 *
 * The list is a draft held here and written once, on Confirm, because
 * `visit.setProcedures` replaces the whole list rather than patching a line
 * (§8) — a write per keystroke would send the entire visit over Tailscale every
 * time a price was corrected. The draft is seeded from the visit, so re-opening
 * a visit shows what is already on it and Confirm is safe to press twice.
 *
 * Prices are the visit's own snapshot, editable in place: the catalogue's price
 * is where a line starts, not what it is, and a discount given in the chair is
 * given on this screen. Whole pounds in, integer piastres held (§7.12).
 *
 * The note is the appointment's (`appointments.note`), the same one the
 * booking page writes and the doctor's sheet reads — `visits` has no column of
 * its own, and a second note would leave the desk and the chair each holding
 * half of what was said. It is seeded from the appointment, edited here, and
 * written with the rest on Confirm; blank clears it.
 *
 * One thing the design draws that the server cannot hold, and so is not here:
 * the category a variant belongs to. `visit_procedures` stores the leaf, so a
 * re-opened "Composite filling · Class II" reads back as "Class II" — the line
 * is right, its heading is not remembered.
 */
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
import { asksTooth, chargeableTotal, checkupIsWaived, toothGroupsOf, toothPosition } from '../procedures';
import { dateKey, dayOfMonth, formatLongDate, formatTime12, monthShort, todayKey } from '../time';
import { PlusIcon, XIcon } from './icons';
import { type PickedProcedure, ProcedureSheet } from './ProcedureSheet';
import { ToothSheet } from './ToothSheet';
import { VisitStatusChip, visitState } from './VisitStatusChip';

/**
 * A line as the screen holds it. `quantity` has no control anywhere in the
 * design — it is 1 on nearly every line — but it is carried so that a visit
 * priced elsewhere with a quantity on it does not silently lose the multiple
 * when this screen writes the list back.
 */
type DraftLine = {
    /** Local to the draft; `visit_procedures` rows are replaced wholesale. */
    id: string;
    procedureId: string;
    name: string;
    variant: string | null;
    tooth: Tooth | null;
    /**
     * Piastres, per unit. Null on an arrival line that nobody has repriced: the
     * booking carries no price (§7 — the visit snapshots the catalogue on the
     * day), so until it does the price is the catalogue's, read at render. A
     * number here is a price someone typed.
     */
    unitPrice: number | null;
    quantity: number;
    /**
     * What the server said this line was, where it has already said it. The
     * catalogue is the authority (`checkupIds` below) and it answers for every
     * line once it lands — this is only so a checkout opened before the
     * catalogue arrives does not paint one checkup too many for a frame, which
     * on this screen is a wrong price in front of the person paying it.
     */
    isCheckup: boolean;
};

/**
 * A total is an estimate before the work, a running figure during it, and just
 * the total once the visit is closed — nothing is accruing on a visit being
 * corrected weeks later.
 */
const TOTAL: Record<Standing | 'arriving', string> = {
    arriving: 'Estimated total',
    waiting: 'Estimated total',
    chair: 'Running total',
    desk: 'Running total',
    finished: 'Total',
};

export type VisitScreenProps = {
    appointment: Appointment;
    /**
     * Absent on an arrival — there is no visit until Confirm creates one. The
     * list then comes from what the booking planned.
     */
    visit?: Visit;
    /**
     * Why the screen is open, which is what its bottom bar means.
     *
     * `arrival` — the patient has just walked in. The list is what they are
     * here *for*, seeded from the booking, and confirming it puts them in the
     * chair or in the queue. Nothing is finished, so there is no payment and
     * nobody is going to the desk.
     *
     * `checkout` — the work is done. Confirm goes on to the money, or the desk
     * takes it instead and frees the chair.
     */
    mode: 'arrival' | 'checkout';
    /**
     * Where the patient is standing. It is not the status: two patients are
     * both `checked_in` while one is in the chair and the other is in the queue
     * behind them, and only the day view — which owns the queue — can tell them
     * apart. Left off (a patient's record, where there is no queue in view) it
     * falls back to what the status alone can say.
     */
    standing?: Standing;
    onBack: () => void;
    /** The visit as the server priced it. Where that goes is the caller's. */
    onConfirm: (visit: Visit) => void;
    /**
     * The note as it was written, when Confirm changed it. It is the
     * appointment's, not the visit's, so a caller holding an appointment of its
     * own has to be told — nothing in the priced visit carries it back.
     */
    onNoteSaved?: (note: string | null) => void;
    /** Priced and handed to the desk; the chair is free and nobody has paid. */
    onSentToDesk?: (message: string) => void;
    /**
     * Opened from the doctor's Finish. The visit is being finished either way,
     * so the one button saves and sends to the desk — a Confirm that saved and
     * stopped would leave the patient in the chair after the doctor said done.
     */
    finishing?: boolean;
};

/**
 * Which question is open: the tooth, the catalogue, or neither — plus the tooth
 * asked the other way round, after a pick from the general sheet that turned
 * out to need one.
 */
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

    // An arrival: the booking's plan, unpriced. Check-in seeds exactly this, so
    // what the screen shows is what the visit opens with.
    return appointment.procedures.map((line) => ({
        id: line.id,
        procedureId: line.procedureId,
        name: line.name,
        variant: null,
        tooth: line.tooth,
        unitPrice: null,
        quantity: line.quantity,
        // The booking does not carry the flag; the catalogue answers for these.
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
    const [note, setNote] = useState(() => noteDraft(appointment.note));
    const [asking, setAsking] = useState<Asking>(null);
    const [collapsed, setCollapsed] = useState<readonly string[]>([]);
    const [toast, setToast] = useState<string | null>(null);
    // Whether the list still is what it arrived as. An untouched arrival is
    // sent as nothing at all, so check-in's own seeding stands.
    const [edited, setEdited] = useState(false);

    const catalogue = useLocalQuery('procedure-tree', api.procedureTree);
    const general = useGeneralClinic();
    const price = useLocalMutation(amend);
    const checkIn = useLocalMutation(arrive);
    const sendToDesk = useLocalMutation(api.awaitPayment);

    /**
     * Which of the two footer buttons is mid-write. `amend` alone cannot say:
     * both press it, Send to desk as the first half of its pair, so keying the
     * spinner off `price.pending` put it on Confirm whichever was pressed. Set
     * before the mutation, so the re-render its `pending` causes reads it.
     */
    const acting = useRef<'confirm' | 'desk'>('confirm');

    // What the catalogue charges, by procedure. An arrival's lines carry no
    // price of their own until one is typed over them.
    const prices = useMemo(() => {
        const map = new Map<string, number>();
        for (const category of catalogue.data ?? []) {
            map.set(category.id, category.defaultPrice);
            for (const child of category.children) map.set(child.id, child.defaultPrice);
        }
        return map;
    }, [catalogue.data]);

    // Which procedure holds the checkup flag, so the waiver below lands on the
    // same line the server waives. Asked of the catalogue rather than of the
    // line, because a checkup planned by the booking or picked out of the sheet
    // in the chair does not carry the flag.
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
    // Per unit on both sides, so a quantity does not read as a discount.
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
    // The waiver is a fact about the visit, so it is decided once over the whole
    // list and then applied to the groups — a subtotal struck under its own
    // group would leave the checkup charging for itself in the no-tooth group
    // while the total below had already dropped it.
    const waived = checkupIsWaived(priced(lines));
    const subtotalOf = (rows: readonly DraftLine[]): number => chargeableTotal(priced(rows), waived);

    const total = subtotalOf(lines);
    const empty = lines.length === 0;

    // A patient already at the desk cannot be sent there, and one still in the
    // queue has had nothing done to pay for — so the second button belongs to
    // the chair alone. `planning` is the other half of the same fact: until
    // someone is in the chair the list is what they are here *for*, not a
    // record of what was done, and it is allowed to be empty.
    const where = mode === 'arrival' ? 'arriving' : (standing ?? standingFor(appointment, todayKey()));
    const inChair = where === 'chair';
    const planning = where === 'arriving' || where === 'waiting';

    function startAdding() {
        setAsking(
            asksTooth(catalogue.data, general) ? { step: 'tooth' } : { step: 'procedure', tooth: null },
        );
    }

    /**
     * Both questions are `Modal`s, and presenting one while another is still
     * dismissing is how iOS silently drops the second — so the catalogue waits
     * out the tooth sheet's exit rather than racing it.
     */
    function askProcedure(tooth: Tooth | null, afterSheet: boolean) {
        if (!afterSheet) {
            setAsking({ step: 'procedure', tooth });
            return;
        }
        setAsking(null);
        setTimeout(() => setAsking({ step: 'procedure', tooth }), duration.sheet);
    }

    /**
     * The general sheet offers the whole catalogue, so a pick can arrive owing
     * a tooth. Ask for it before the line exists rather than after — a line
     * with no tooth is one §5 refuses at confirm, with the visit already priced.
     */
    function pick(tooth: Tooth | null, picked: PickedProcedure) {
        if (tooth === null && picked.needsTooth) {
            setAsking(null);
            setTimeout(() => setAsking({ step: 'toothFor', picked }), duration.sheet);
            return;
        }
        add(tooth, picked);
    }

    function add(tooth: Tooth | null, picked: PickedProcedure) {
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
                // The pick does not carry the flag; the catalogue answers for it.
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

    /** The note as the write takes it: `undefined` when nobody touched it. */
    const notePatch = (): string | null | undefined =>
        noteChanged(appointment.note, note) ? noteValue(note) : undefined;

    /**
     * Both checkout buttons write the same list first — what was done is
     * recorded either way, and the only difference is who takes the money next.
     */
    function save(then: (priced: Visit) => void) {
        // Only a visit on its way to the money has to have something on it. A
        // plan legitimately does not — what is done is decided in the chair,
        // and refusing to confirm someone into the waiting room over an empty
        // list would be refusing to admit a patient who is standing there.
        if (empty && !planning) {
            setToast('Add at least one procedure before continuing');
            return;
        }
        if (!visit) return;

        const savedNote = notePatch();

        // `closed` is what turns this into a correction: the visit is reopened
        // as part of the write, never on the way in. A visit sent to the desk
        // and not yet paid for is already open and needs no such thing.
        price.mutate(
            {
                visitId: visit.id,
                appointmentId: appointment.id,
                closed: visit.completedAt !== null,
                procedures: written(),
                note: savedNote,
            },
            {
                onSuccess: (priced) => {
                    if (savedNote !== undefined) onNoteSaved?.(savedNote);
                    then(priced);
                },
            },
        );
    }

    /**
     * Confirming an arrival is what checks the patient in — not opening this
     * screen. Backing out of it leaves them still `booked`, because nothing was
     * written and nothing is what happened.
     */
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

    /**
     * The doctor is done and the patient pays at the front. It frees the chair
     * and settles nothing (§8) — the desk opens the same visit and takes the
     * payment there.
     */
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
    // Confirm carries the arrival too: on `arrival` it is `arrive` that runs,
    // not `amend`, and keying off `amend` alone left check-in — the write the
    // desk makes most — looking idle for the whole round trip.
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
                            onPress={startAdding}
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
                                                        {/* Read only: what a typed price takes off
                                                            the catalogue's. A price at or above it
                                                            says nothing. */}
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
                                                        {/* The price stays on the line — it is what
                                                            the checkup costs, and the row is the
                                                            record that the patient was seen — so
                                                            without this the total looks short by it. */}
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
                        onPress={startAdding}
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

            {/* The mock's pair — the doctor takes the payment himself, or frees
                the chair and lets the desk — is the chair's alone. An arrival,
                a patient still in the queue and one already standing at the
                desk each get the single button, because for all three the desk
                is not the next place they go. Opened from Finish, the desk is
                already decided and the one button goes there. */}
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
                // The variant is what was tapped; the category alone reads as
                // "Surgical is done to a tooth", which names nothing.
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
    // `canvas`, not the mock's white page. The shell paints the status-bar
    // inset (`App.tsx`) and every other screen in canvas, so a white page here
    // banded the top of the screen in three greys. The cards keep their white.
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
    // The mock's `rgba(255,255,255,.62)` — a second white on ink, which the
    // palette has no token for because nothing else sits on a dark ground.
    tileMonth: { opacity: 0.62 },
    who: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
    // The chip sizes itself; the row is only what holds it off the line above
    // and keeps it from stretching the width of the column.
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
    // `Button` sits `alignSelf: 'flex-start'` by default, which beats the
    // column's `alignItems: 'center'` — the mock centres this one under its
    // heading.
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
    // `appointment-view.html`'s badge, not `check-in.html`'s: the tooth is the
    // thing the eye finds first down a column of cards, and an ink chip finds
    // itself. An unassigned line keeps the dashed outline — there is nothing to
    // pick out.
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
    // A `TextInput`, so it inherits nothing from `theme/Text` — the family has
    // to be named here or Android renders it in the system face. `fontWeight`
    // is deliberately absent: RN picks a face by family name and never
    // synthesises a weight, and DM Mono ships 400 and 500 only.
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
        // `surface2` where the mock says `canvas`: the page is canvas now, and
        // a canvas block on a canvas page is not a block.
        backgroundColor: color.surface2,
    },
    totalIdle: { opacity: 0.5 },

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    bar: {
        flexDirection: 'row',
        gap: space[2],
        paddingHorizontal: size.gutter,
        paddingTop: space[3.5],
        // The tab bar is below this again and owns the gesture inset, so the
        // bar only needs its own breathing room — `space[6]` left the button
        // floating well clear of the tabs. `paddingBottom` is supplied inline:
        // it carries the keyboard as well, since the window no longer shrinks
        // around it (see `ui/useKeyboardHeight`), and the per-procedure cost
        // fields in this scroll sit low enough to go under it.
        // The same ground as the page. The mock fades its bar into the page
        // rather than sitting a panel on it, so a white bar on canvas read as
        // a seam across the bottom of the screen.
        backgroundColor: color.canvas,
    },
    // Even halves: "Send to desk" wrapped to two lines at anything narrower,
    // and a two-line label next to a one-line one is what made the bar look
    // broken rather than secondary.
    secondaryAction: { flex: 1 },
    primaryAction: { flex: 1 },
    pressed: { opacity: 0.72 },
});
