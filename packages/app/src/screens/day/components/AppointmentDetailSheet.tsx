/**
 * One appointment and everything that can happen to it from here. Every write
 * crosses Tailscale and reports its failure *in this sheet*, next to the
 * button that caused it — never a toast that fades. Destructive steps confirm
 * inline because `Sheet` is a `Modal`, and a modal over a modal is how
 * Android's back button ends up cancelling a write already in flight. The
 * inline confirm takes the footer with it: leaving Check in under "Cancel this
 * appointment?" offers two answers to one question. The Check out button is
 * disabled without a visit because (BLOCKED.md) the id is only known for a
 * visit this session checked in.
 *
 * The title is the patient and opens their record, because that is what the
 * name on a sheet is for — the desk taps a row to find out who is coming and
 * then wants their history, and the only way there used to be backing out to
 * the day and searching the patients tab for a name already on the screen.
 *
 * The actions below are three weights, not three of the same: Reschedule keeps
 * the appointment and is bordered, no-show is a correction and is quiet,
 * cancel is destructive and is the only red. They were two identical outlines
 * and a red link, which put the mildest and the most dangerous of the three at
 * the same size and made the wall of full-width buttons read as one control
 * repeated.
 *
 * Lab work sits with the facts, not the actions: it is something to know about
 * the booking, and turning it on or off changes nothing about the slot. It is
 * editable only while the appointment is booked — past check-in the patient is
 * in the chair and the question has been answered. The sheet holds a snapshot,
 * so a lab write is shown from its own answer until the day re-reads.
 *
 * One rule in the body, and it spans the sheet like the footer's does. Hairlines
 * between every pair of facts chopped a short sheet into four, and an inset rule
 * over a full-bleed one reads as two different rules.
 */
import type { LabStatus } from '@lustre/shared';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MoneyValue, StatusPill } from '../../../components/domain';
import { Button, Callout, Sheet, Switch, Tag } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import { bookingActions } from '../actions';
import {
    type Appointment,
    type AppointmentProcedure,
    api,
    useLocalMutation,
    useLocalQuery,
    type Visit,
    visitForAppointment,
} from '../data';
import { describeError } from '../errors';
import { formatSpan, minutesOfDay, todayKey } from '../time';
import { CancelAppointmentIcon, CheckIcon, LabIcon, NoShowIcon, RescheduleIcon } from './icons';

export type AppointmentDetailSheetProps = {
    visible: boolean;
    appointment: Appointment | null;
    onClose: () => void;
    onChanged: () => void;
    onCheckOut: (appointment: Appointment, visit: Visit) => void;
    /**
     * Handed up rather than done here: checking in opens the arrival screen,
     * and that page belongs to the day view. Doing the write in this sheet was
     * how the same button ended up meaning two different things depending on
     * which of them you pressed.
     */
    onCheckIn: (appointment: Appointment) => void;
    /**
     * Handed up for the same reason: picking the new time happens on the
     * booking page's When step, which the day view pushes. Nothing is written
     * until that page's button.
     */
    onReschedule: (appointment: Appointment) => void;
    /** The patient behind the appointment, from their name at the top of the sheet. */
    onOpenRecord: (appointment: Appointment) => void;
    /**
     * All of those open a page over the day, so none may draw until this sheet
     * is off the screen. See `Sheet`'s `onClosed`.
     */
    onClosed?: () => void;
    /**
     * Whether this patient heads the arrival queue. `checked_in` is everyone
     * who has arrived, so the pill needs the queue to tell the chair from the
     * waiting room.
     */
    inChair?: boolean;
};

type Confirming = 'cancel' | 'no-show' | null;

/** Statuses that are over: one line saying so, and nothing to press. */
const TAIL: Partial<Record<Appointment['status'], string>> = {
    done: 'This visit is finished.',
    cancelled: 'This appointment was cancelled. The slot is free.',
    no_show: 'Marked as a no-show. The slot is free.',
};

export function AppointmentDetailSheet({
    visible,
    appointment,
    onClose,
    onChanged,
    onCheckOut,
    onCheckIn,
    onReschedule,
    onOpenRecord,
    onClosed,
    inChair = false,
}: AppointmentDetailSheetProps) {
    const t = useT();
    const [confirming, setConfirming] = useState<Confirming>(null);

    const awaitPayment = useLocalMutation(api.awaitPayment);
    const cancel = useLocalMutation(api.cancel);
    const noShow = useLocalMutation(api.markNoShow);
    const setNeedsLab = useLocalMutation((input: { id: string; needsLab: boolean }) =>
        api.setNeedsLab(input.id, input.needsLab),
    );
    const labReady = useLocalMutation(api.markLabReady);
    // What this sheet last wrote, stamped with the row's `updatedAt` from the
    // write. It stands only while the snapshot is older than that: once the day
    // re-reads, whatever it brings back — this write or a later one from
    // another phone — wins. Comparing values instead would let a later revert
    // to the old value bring the override back.
    const [labWrite, setLabWrite] = useState<{ status: LabStatus | null; at: number } | null>(null);

    const status = appointment?.status;
    const hasVisit = status === 'checked_in' || status === 'awaiting_payment' || status === 'done';

    const visit = useLocalQuery<Visit | null>(
        `visit:${appointment?.id ?? 'none'}`,
        () => (appointment ? visitForAppointment(appointment.id) : Promise.resolve(null)),
        { enabled: visible && hasVisit },
    );

    const labWriting = setNeedsLab.pending || labReady.pending;
    const writing = awaitPayment.pending || cancel.pending || noShow.pending || labWriting;
    const writeError = awaitPayment.error ?? cancel.error ?? noShow.error;
    const labError = setNeedsLab.error ?? labReady.error;

    function after() {
        setConfirming(null);
        onChanged();
        onClose();
    }

    // A confirm left open would come back with the next appointment, and the
    // footer is hidden while one is up — the sheet would reopen with no way in.
    function close() {
        setConfirming(null);
        onClose();
    }

    if (!appointment) {
        return <Sheet visible={visible} onClose={close} onClosed={onClosed} title="Appointment" />;
    }

    const startMinutes = minutesOfDay(appointment.startsAt);
    const labStatus =
        labWrite && Date.parse(appointment.updatedAt) < labWrite.at ? labWrite.status : appointment.labStatus;

    function labWritten(result: { labStatus: LabStatus | null; updatedAt: string }) {
        setLabWrite({ status: result.labStatus, at: Date.parse(result.updatedAt) });
        onChanged();
    }

    return (
        <Sheet
            visible={visible}
            onClose={close}
            onClosed={onClosed}
            dismissable={!writing}
            title={appointment.patient.name}
            subtitle={`${formatSpan(
                startMinutes,
                startMinutes + appointment.durationMinutes,
            )} · ${t('{minutes} min', { minutes: appointment.durationMinutes })}`}
            // Off while a write is in flight, for the reason `dismissable`
            // is: leaving takes the failure with it, and this sheet is where
            // a failure is reported. The chevron and the button role go with
            // it, so the row stops offering what it cannot do.
            onTitlePress={
                writing
                    ? undefined
                    : () => {
                          close();
                          onOpenRecord(appointment);
                      }
            }
            titleAccessibilityLabel={t("Open {name}'s record", { name: appointment.patient.name })}
            testID="appointment-detail"
            footer={
                confirming ? null : (
                    <PrimaryAction
                        appointment={appointment}
                        visit={visit.data ?? null}
                        visitLoading={visit.status === 'loading'}
                        checkingIn={false}
                        onCheckIn={() => {
                            close();
                            onCheckIn(appointment);
                        }}
                        onCheckOut={(loaded) => onCheckOut(appointment, loaded)}
                    />
                )
            }
        >
            <View style={styles.headline}>
                <StatusPill status={appointment.status} inChair={inChair} withDot />
                {appointment.channel === 'walk_in' ? <Tag tone="muted">WALK-IN</Tag> : null}
                <Text variant="footnote" script="mono" weight="medium" tone="muted">
                    {t('Patient #{ref}', { ref: appointment.patient.ref })}
                </Text>
            </View>

            {/* What they are in for, in one line: it is what the row was tapped
                to find out. The note sits under it unlabelled — it is the only
                prose on the sheet. */}
            <View style={styles.facts}>
                <Text variant="headline" weight="semibold">
                    {planLine(appointment.procedures) ??
                        t('Nothing planned — it will be decided in the chair.')}
                </Text>
                {appointment.note ? (
                    <Text variant="subhead" tone="ink2">
                        {appointment.note}
                    </Text>
                ) : null}
            </View>

            <LabPanel
                status={labStatus}
                editable={appointment.status === 'booked'}
                markingReady={labReady.pending}
                disabled={writing}
                onSwitch={(needsLab) => {
                    labReady.reset();
                    setNeedsLab.mutate({ id: appointment.id, needsLab }, { onSuccess: labWritten });
                }}
                onReady={() => {
                    setNeedsLab.reset();
                    labReady.mutate(appointment.id, { onSuccess: labWritten });
                }}
            />

            {labError ? (
                <Callout tone="warning" title={describeError(labError).title}>
                    {describeError(labError).body ?? ''}
                </Callout>
            ) : null}

            {hasVisit ? (
                <VisitPanel
                    visit={visit.data ?? null}
                    loading={visit.status === 'loading'}
                    failed={visit.status === 'error'}
                    onRetry={visit.refetch}
                />
            ) : null}

            {writeError ? (
                <Callout tone="warning" title={describeError(writeError, 'check-in').title}>
                    {describeError(writeError, 'check-in').body ?? ''}
                </Callout>
            ) : null}

            <SecondaryActions
                appointment={appointment}
                confirming={confirming}
                setConfirming={setConfirming}
                sendingToDesk={awaitPayment.pending}
                cancelling={cancel.pending}
                markingNoShow={noShow.pending}
                onSendToDesk={() => awaitPayment.mutate(appointment.id, { onSuccess: after })}
                onCancel={() => cancel.mutate(appointment.id, { onSuccess: after })}
                onNoShow={() => noShow.mutate(appointment.id, { onSuccess: after })}
                onReschedule={() => {
                    close();
                    onReschedule(appointment);
                }}
            />
        </Sheet>
    );
}

function PrimaryAction({
    appointment,
    visit,
    visitLoading,
    checkingIn,
    onCheckIn,
    onCheckOut,
}: {
    appointment: Appointment;
    visit: Visit | null;
    visitLoading: boolean;
    checkingIn: boolean;
    onCheckIn: () => void;
    onCheckOut: (visit: Visit) => void;
}) {
    switch (appointment.status) {
        case 'booked':
            // Only on the appointment's own day. From another day's list it is a
            // mis-tap, and the server refuses it anyway.
            return bookingActions(appointment, todayKey()).checkIn ? (
                <Button
                    label="Check in"
                    block
                    icon={<CheckIcon size={18} stroke={color.inverse} width={2.4} />}
                    loading={checkingIn}
                    onPress={onCheckIn}
                />
            ) : null;

        case 'checked_in':
        case 'awaiting_payment':
            return (
                <Button
                    label="Check out"
                    block
                    loading={visitLoading}
                    disabled={!visit && !visitLoading}
                    onPress={() => visit && onCheckOut(visit)}
                />
            );

        default:
            return null;
    }
}

function SecondaryActions({
    appointment,
    confirming,
    setConfirming,
    sendingToDesk,
    cancelling,
    markingNoShow,
    onSendToDesk,
    onCancel,
    onNoShow,
    onReschedule,
}: {
    appointment: Appointment;
    confirming: Confirming;
    setConfirming: (next: Confirming) => void;
    sendingToDesk: boolean;
    cancelling: boolean;
    markingNoShow: boolean;
    onSendToDesk: () => void;
    onCancel: () => void;
    onNoShow: () => void;
    onReschedule: () => void;
}) {
    const t = useT();
    const status = appointment.status;

    if (status === 'checked_in') {
        return (
            <Group>
                <Button
                    label="Send to the desk"
                    variant="secondary"
                    size="md"
                    block
                    loading={sendingToDesk}
                    onPress={onSendToDesk}
                />
            </Group>
        );
    }

    if (status !== 'booked') {
        const tail = TAIL[status];
        return tail ? (
            <Group>
                <Text variant="subhead" tone="muted">
                    {t(tail)}
                </Text>
            </Group>
        ) : null;
    }

    if (confirming) {
        const isCancel = confirming === 'cancel';
        return (
            <Group>
                <Text variant="headline" weight="semibold">
                    {isCancel ? t('Cancel this appointment?') : t('Mark this a no-show?')}
                </Text>
                <Text variant="subhead" tone="muted" style={styles.confirmBody}>
                    {isCancel
                        ? t(
                              'The slot goes back on the day and the patient keeps their record. Nothing is deleted.',
                          )
                        : t(
                              'They did not come. The slot goes back on the day and the visit is left unbooked.',
                          )}
                </Text>
                <View style={styles.confirmRow}>
                    <Button
                        label="Keep it"
                        variant="ghost"
                        size="md"
                        onPress={() => setConfirming(null)}
                        style={styles.confirmHalf}
                    />
                    <Button
                        label={isCancel ? 'Cancel it' : 'No-show'}
                        variant="danger"
                        size="md"
                        loading={isCancel ? cancelling : markingNoShow}
                        onPress={isCancel ? onCancel : onNoShow}
                        style={styles.confirmHalf}
                    />
                </View>
            </Group>
        );
    }

    // Tiles, not a stack: one row the width of the sheet, each a big target,
    // with the destructive one the only red. A booking on a later day has no
    // No-show — nobody has failed to come yet — and keeps Cancel, which is
    // the call the patient rings to make.
    const actions = bookingActions(appointment, todayKey());
    return (
        <View style={styles.tiles}>
            <Tile
                label="Reschedule"
                icon={<RescheduleIcon size={20} stroke={color.ink} />}
                onPress={onReschedule}
                testID="appointment-reschedule"
            />
            {actions.noShow ? (
                <Tile
                    label="No-show"
                    icon={<NoShowIcon size={20} stroke={color.ink2} />}
                    onPress={() => setConfirming('no-show')}
                    testID="appointment-no-show"
                />
            ) : null}
            <Tile
                label="Cancel"
                accessibilityLabel="Cancel appointment"
                danger
                icon={<CancelAppointmentIcon size={20} stroke={color.dangerText} />}
                onPress={() => setConfirming('cancel')}
                testID="appointment-cancel"
            />
        </View>
    );
}

function Tile({
    label,
    accessibilityLabel,
    icon,
    danger = false,
    onPress,
    testID,
}: {
    label: string;
    accessibilityLabel?: string;
    icon: ReactNode;
    danger?: boolean;
    onPress: () => void;
    testID: string;
}) {
    const t = useT();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(accessibilityLabel ?? label)}
            onPress={onPress}
            testID={testID}
            style={({ pressed }) => [styles.tile, danger && styles.tileDanger, pressed && styles.tilePressed]}
        >
            {icon}
            <Text variant="subhead" weight="semibold" tone={danger ? 'danger' : 'ink'}>
                {t(label)}
            </Text>
        </Pressable>
    );
}

/**
 * Everything below the record is one group behind one rule, and that rule
 * bleeds to the sheet's edges the way the footer's does — an inset rule above a
 * full-bleed one reads as a mistake. It carries its own divider so a status with
 * nothing to say — at the desk, waiting on the checkout — ends the sheet at the
 * record instead of on a rule with an empty row under it.
 */
function Group({ children }: { children: ReactNode }) {
    return (
        <View style={styles.group}>
            <View style={styles.rule} />
            <View style={styles.actions}>{children}</View>
        </View>
    );
}

function VisitPanel({
    visit,
    loading,
    failed,
    onRetry,
}: {
    visit: Visit | null;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
}) {
    const t = useT();
    if (loading) {
        return (
            <View style={styles.panel}>
                <Text variant="subhead" tone="muted">
                    {t('Loading the visit…')}
                </Text>
            </View>
        );
    }

    if (failed) {
        return (
            <View style={styles.panel}>
                <Text variant="subhead" tone="due">
                    {t('The visit could not be loaded.')}
                </Text>
                <Button label="Try again" variant="text" size="md" onPress={onRetry} />
            </View>
        );
    }

    if (!visit) {
        return (
            <View style={styles.panel}>
                <Text variant="subhead" tone="muted">
                    {t(
                        'This patient was checked in before the app was opened, so the visit is not to hand. Open it from the visit screen to check them out.',
                    )}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.panel}>
            {visit.chargedTotal !== null ? (
                <View style={styles.money}>
                    <Text variant="subhead" tone="muted">
                        {t('Charged')}
                    </Text>
                    <MoneyValue piastres={visit.chargedTotal} />
                </View>
            ) : null}
            {/* Null on a phone whose role is not shown payments. */}
            {visit.paidTotal !== null ? (
                <View style={styles.money}>
                    <Text variant="subhead" tone="muted">
                        {t('Paid')}
                    </Text>
                    <MoneyValue piastres={visit.paidTotal} tone="success" />
                </View>
            ) : null}
            {visit.balance !== null && visit.balance > 0 ? (
                <View style={styles.money}>
                    <Text variant="subhead" tone="muted">
                        {t('Outstanding')}
                    </Text>
                    <MoneyValue piastres={visit.balance} tone="due" />
                </View>
            ) : null}
        </View>
    );
}

/**
 * The switch while the booking can still change, and the state of the work
 * under it when there is any. Nothing at all for a finished appointment that
 * never needed a lab.
 */
function LabPanel({
    status,
    editable,
    markingReady,
    disabled,
    onSwitch,
    onReady,
}: {
    status: LabStatus | null;
    editable: boolean;
    markingReady: boolean;
    disabled: boolean;
    onSwitch: (needsLab: boolean) => void;
    onReady: () => void;
}) {
    const t = useT();
    if (!editable && status === null) return null;

    const tint = status === 'pending' ? styles.labPending : status === 'ready' ? styles.labReady : null;

    return (
        <View style={[styles.lab, tint]} testID="appointment-lab">
            <View style={styles.labRow}>
                <LabIcon
                    size={18}
                    stroke={
                        status === 'pending' ? color.due : status === 'ready' ? color.success : color.muted
                    }
                />
                <View style={styles.labText}>
                    <Text variant="callout" weight="semibold">
                        {t('Needs lab')}
                    </Text>
                    <Text
                        variant="footnote"
                        weight={status ? 'semibold' : 'regular'}
                        tone={status === 'pending' ? 'dueText' : status === 'ready' ? 'successText' : 'muted'}
                    >
                        {status === 'pending'
                            ? t('Not back from the lab yet')
                            : status === 'ready'
                              ? t('Back from the lab')
                              : t('A crown, bridge or denture')}
                    </Text>
                </View>
                {editable ? (
                    <Switch
                        value={status !== null}
                        onValueChange={onSwitch}
                        disabled={disabled}
                        accessibilityLabel="Needs lab"
                        testID="appointment-needs-lab"
                    />
                ) : null}
            </View>
            {editable && status === 'pending' ? (
                <Button
                    label="Mark lab arrived"
                    variant="inverse"
                    size="md"
                    block
                    icon={<CheckIcon size={17} stroke={color.ink} width={2.4} />}
                    loading={markingReady}
                    disabled={disabled && !markingReady}
                    onPress={onReady}
                    testID="appointment-lab-arrived"
                />
            ) : null}
        </View>
    );
}

/** The booked procedures as one line — `Root canal · UL6, Consultation` — or null for none. */
function planLine(procedures: readonly AppointmentProcedure[]): string | null {
    if (procedures.length === 0) return null;
    return procedures
        .map((procedure) => {
            const name =
                procedure.quantity > 1 ? `${procedure.name} × ${procedure.quantity}` : procedure.name;
            return procedure.tooth ? `${name} · ${procedure.tooth}` : name;
        })
        .join(', ');
}

const styles = StyleSheet.create({
    headline: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
    facts: { gap: space[1.5] },
    lab: {
        paddingVertical: space[3],
        paddingHorizontal: space[3.5],
        gap: space[2.5],
        backgroundColor: color.canvas,
        borderRadius: radius.lg,
    },
    labPending: { backgroundColor: color.dueSoft },
    labReady: { backgroundColor: color.successSoft },
    labRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    labText: { flex: 1, gap: space[0.5] },
    tiles: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
    tile: {
        flex: 1,
        minHeight: 76,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1.5],
        borderRadius: radius.xl,
        backgroundColor: color.surface2,
    },
    tileDanger: { backgroundColor: color.dangerSoft },
    tilePressed: { opacity: 0.72 },
    panel: {
        padding: space[3.5],
        gap: space[2],
        backgroundColor: color.canvas,
        borderRadius: radius.xl,
    },
    money: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    group: { marginTop: space[2], gap: space[4] },
    // Out of the scroll's gutter and back, so the rule reaches both edges the
    // way `Sheet`'s footer rule does.
    rule: { marginHorizontal: -size.gutter, height: 1, backgroundColor: color.hair },
    actions: { gap: space[2] },
    confirmBody: { marginBottom: space[1] },
    confirmRow: { flexDirection: 'row', gap: space[2] },
    confirmHalf: { flex: 1 },
});
