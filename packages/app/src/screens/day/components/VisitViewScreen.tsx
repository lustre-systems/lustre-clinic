/**
 * A visit that is over — `appointment-view.html`. The same cards as
 * `VisitScreen` with the inputs taken out: what was done, and what was paid for
 * it, split by the segmented control because they are two questions and a
 * finished visit is usually opened for one of them.
 *
 * Read-only is the resting state, not the only one. `Edit visit` hands the
 * visit to `VisitScreen` and writes nothing: the reopen the server needs before
 * `setProcedures` will take on a completed visit happens on that screen's
 * Confirm, with the edit itself. Opening the editor and backing out of it left
 * a closed visit standing open here — the same mistake as checking a patient in
 * the moment their arrival screen was opened.
 *
 * The note is the appointment's, shown here because the visit editor writes it
 * and a note that only appears on the booking page is one nobody reads back.
 * The mock's billing note is left out: `visits` has no column to hold it.
 *
 * The two deletes are written from here rather than handed up. Both mounts of
 * this screen would only have run the same confirm and the same call, and what
 * they differ on — where to go afterwards — is the one callback they get.
 * Deleting a payment leaves the screen where it is with the visit re-read;
 * deleting the visit leaves nothing to show, so `onDeleted` is the way out.
 */
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
    Button,
    Chevron,
    ConfirmSheet,
    IconButton,
    PopoverMenu,
    SegmentedControl,
    Toast,
} from '../../../components/ui';
import { useT } from '../../../i18n';
import { getLocale } from '../../../i18n/runtime';
import { border, color, radius, size, space, Text } from '../../../theme';
import {
    type Appointment,
    api,
    useGeneralClinic,
    useLocalMutation,
    type Visit,
    type VisitPayment,
} from '../data';
import { describeError } from '../errors';
import { formatAmount, formatMoney } from '../money';
import { chargeableTotal, checkupIsWaived, toothGroupsOf, toothPosition } from '../procedures';
import { dateKey, dayOfMonth, formatLongDate, formatTime12, monthShort } from '../time';
import { MoreIcon, TrashIcon } from './icons';
import { VisitStatusChip } from './VisitStatusChip';

export type VisitViewScreenProps = {
    appointment: Appointment;
    visit: Visit;
    onBack: () => void;
    /** Open the editor over this page. Nothing has been written to the visit. */
    onEdit: (visit: Visit) => void;
    /** The visit is gone; whatever is underneath is stale and this page has nothing left to show. */
    onDeleted: () => void;
    /** A payment came off and the visit was re-read. */
    onPaymentDeleted: (visit: Visit) => void;
};

type Panel = 'treatment' | 'payment';

const METHOD_LABEL: Record<string, string> = {
    cash: 'Cash',
    visa: 'Card',
    instapay: 'Instapay',
    other: 'Other',
};

function methodLabel(payment: VisitPayment): string {
    if (payment.method === 'other') return payment.methodNote?.trim() || 'Other';
    return METHOD_LABEL[payment.method] ?? payment.method;
}

/** The tile's month: capitals in English, the month's name in Arabic, which has no capitals. */
function monthOf(iso: string): string {
    const month = monthShort(dateKey(iso));
    return getLocale() === 'ar' ? month : month.toUpperCase();
}

export function VisitViewScreen({
    appointment,
    visit,
    onBack,
    onEdit,
    onDeleted,
    onPaymentDeleted,
}: VisitViewScreenProps) {
    const t = useT();
    const [panel, setPanel] = useState<Panel>('treatment');
    const [menuOpen, setMenuOpen] = useState(false);
    // The menu is a Modal and positions against the window, so the trigger is
    // measured in the window on press — where it sits depends on the status
    // bar and, in a dev build, the DEV strip, neither of which this screen
    // knows about.
    const more = useRef<View>(null);
    const [menuTop, setMenuTop] = useState<number>(space[12]);

    function openMenu() {
        more.current?.measureInWindow((_x, y, _w, h) => {
            setMenuTop(y + h + space[1]);
            setMenuOpen(true);
        });
    }
    const [deletingVisit, setDeletingVisit] = useState(false);
    const [deletingPayment, setDeletingPayment] = useState<VisitPayment | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const deleteVisit = useLocalMutation(api.deleteVisit);
    const deletePayment = useLocalMutation(api.deletePayment);

    function confirmDeleteVisit() {
        deleteVisit.mutate(visit.id, {
            onSuccess: () => {
                setDeletingVisit(false);
                onDeleted();
            },
            onError: (error) => {
                setDeletingVisit(false);
                setToast(describeError(error).body ?? describeError(error).title);
            },
        });
    }

    function confirmDeletePayment() {
        if (!deletingPayment) return;
        deletePayment.mutate(deletingPayment.id, {
            onSuccess: (updated) => {
                setDeletingPayment(null);
                onPaymentDeleted(updated);
            },
            onError: (error) => {
                setDeletingPayment(null);
                setToast(describeError(error).title);
            },
        });
    }

    const groups = toothGroupsOf(visit.procedures);
    const general = useGeneralClinic();
    // "Total cost" below is `chargedTotal`, which the server struck the checkup
    // out of. The group subtotals have to be struck the same way or the lines
    // on this screen visibly do not add up to the total under them.
    const waived = checkupIsWaived(visit.procedures);
    // Null on a doctor's phone, which is not shown payments: the visit is its
    // treatment only, and the payment panel is not offered at all.
    const payments = visit.payments;
    const settled = (visit.balance ?? 0) <= 0;
    // Null on a finished visit a doctor's phone reads: the treatment is shown
    // without a price anywhere on it, and it cannot be reopened to edit.
    const priced = visit.chargedTotal !== null;
    const day = dateKey(appointment.startsAt);

    return (
        <View style={styles.screen} testID="visit-view-screen">
            <View style={styles.topbar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    onPress={onBack}
                    style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
                >
                    <Chevron direction="back" size={10} tone="ink" />
                </Pressable>
                <Text variant="eyebrow" tone="muted" style={styles.grow}>
                    {t('VISIT')}
                </Text>
                <View ref={more} collapsable={false}>
                    <IconButton
                        accessibilityLabel={t('More')}
                        icon={<MoreIcon size={16} stroke={color.ink} />}
                        onPress={openMenu}
                        testID="visit-view-more"
                    />
                </View>
            </View>

            <View style={styles.identity}>
                <View style={styles.tile}>
                    <Text variant="title3" script="sans" weight="semibold" tone="inverse">
                        {dayOfMonth(day)}
                    </Text>
                    <Text variant="tag" tone="inverse" style={styles.tileMonth}>
                        {monthOf(appointment.startsAt)}
                    </Text>
                </View>

                <View style={styles.who}>
                    <Text variant="title2" weight="bold" numberOfLines={2}>
                        {appointment.patient.name}
                    </Text>
                    <Text variant="subhead" tone="muted">
                        {`${formatLongDate(day)} · ${formatTime12(appointment.startsAt)}`}
                    </Text>
                    <View style={styles.chipRow}>
                        <VisitStatusChip state={visit.completedAt ? 'finished' : 'unpaid'} />
                    </View>
                </View>
            </View>

            {payments ? (
                <View style={styles.tabs}>
                    <SegmentedControl<Panel>
                        accessibilityLabel="Treatment or payment"
                        value={panel}
                        onChange={setPanel}
                        segments={[
                            { value: 'treatment', label: 'Treatment' },
                            { value: 'payment', label: `${t('Payment')} · ${payments.length}` },
                        ]}
                    />
                </View>
            ) : null}

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
            >
                {panel === 'treatment' || payments === null ? (
                    <>
                        <View style={styles.sectionHead}>
                            <Text variant="eyebrow" tone="muted">
                                {t('WHAT WAS DONE')}
                            </Text>
                            <Text variant="footnote" tone="muted">
                                {visit.procedures.length === 1
                                    ? t('1 procedure')
                                    : t('{count} procedures', { count: visit.procedures.length })}
                            </Text>
                        </View>

                        {groups.length === 0 ? (
                            <View style={styles.blank}>
                                <Text variant="subhead" tone="muted">
                                    {t('Nothing was recorded on this visit.')}
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.groups}>
                                {groups.map((group) => (
                                    <View key={group.tooth ?? 'none'} style={styles.group}>
                                        <View style={styles.groupHead}>
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
                                                {toothPosition(group.tooth, general)}
                                            </Text>

                                            {priced ? (
                                                <Text variant="callout" script="mono" weight="bold">
                                                    {formatAmount(
                                                        chargeableTotal(
                                                            group.items.map((line) => ({
                                                                ...line,
                                                                unitPrice: line.unitPrice ?? 0,
                                                            })),
                                                            waived,
                                                        ),
                                                    )}
                                                </Text>
                                            ) : null}
                                        </View>

                                        <View>
                                            {group.items.map((line) => (
                                                <View key={line.id} style={styles.line}>
                                                    <View style={styles.grow}>
                                                        <Text variant="callout" weight="semibold">
                                                            {line.quantity > 1
                                                                ? `${line.name} × ${line.quantity}`
                                                                : line.name}
                                                        </Text>
                                                        {/* The price stays on the line — it is what
                                                            the checkup costs, and the row is the
                                                            record that the patient was seen — so
                                                            without this the total looks short by it. */}
                                                        {waived && line.isCheckup ? (
                                                            <Text
                                                                variant="caption"
                                                                tone="muted"
                                                                style={styles.waivedNote}
                                                            >
                                                                {t('Not charged — other work was done')}
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                    {line.lineTotal !== null ? (
                                                        <>
                                                            <Text variant="eyebrow" tone="muted">
                                                                {t('EGP')}
                                                            </Text>
                                                            <Text variant="body" script="mono" weight="bold">
                                                                {formatAmount(line.lineTotal)}
                                                            </Text>
                                                        </>
                                                    ) : null}
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}

                        {appointment.note ? (
                            <View style={styles.note}>
                                <Text variant="eyebrow" tone="muted">
                                    {t('NOTE')}
                                </Text>
                                <Text variant="body" tone="ink2">
                                    {appointment.note}
                                </Text>
                            </View>
                        ) : null}

                        {visit.chargedTotal !== null ? (
                            <View style={styles.total}>
                                <Text variant="subhead" tone="muted">
                                    {t('Total cost')}
                                </Text>
                                <Text variant="headline" script="mono" weight="bold">
                                    {formatMoney(visit.chargedTotal)}
                                </Text>
                            </View>
                        ) : null}
                    </>
                ) : (
                    <>
                        <View style={styles.sectionHead}>
                            <Text variant="eyebrow" tone="muted">
                                {t('PAYMENTS RECEIVED')}
                            </Text>
                            <Text variant="footnote" tone="muted">
                                {t('{paid} of {charged}', {
                                    paid: formatMoney(visit.paidTotal ?? 0),
                                    charged: formatAmount(visit.chargedTotal ?? 0),
                                })}
                            </Text>
                        </View>

                        {payments.length === 0 ? (
                            <View style={styles.blank}>
                                <Text variant="subhead" tone="muted">
                                    {t('Nothing has been paid on this visit yet.')}
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.payments}>
                                {payments.map((payment, index) => (
                                    <View
                                        key={payment.id}
                                        style={[styles.dateRow, index > 0 && styles.dateRowDivided]}
                                    >
                                        <View style={styles.stamp}>
                                            <Text variant="callout" script="mono" weight="bold">
                                                {dayOfMonth(dateKey(payment.paidAt))}
                                            </Text>
                                            <Text variant="tag" tone="muted">
                                                {monthOf(payment.paidAt)}
                                            </Text>
                                        </View>

                                        <Text
                                            variant="subhead"
                                            weight="semibold"
                                            tone="ink2"
                                            numberOfLines={1}
                                            style={styles.grow}
                                        >
                                            {t(methodLabel(payment))}
                                        </Text>

                                        <Text variant="eyebrow" tone="muted">
                                            {t('EGP')}
                                        </Text>
                                        <Text variant="body" script="mono" weight="bold">
                                            {formatAmount(payment.amount)}
                                        </Text>
                                        <IconButton
                                            accessibilityLabel={t('Remove this payment')}
                                            icon={<TrashIcon size={14} stroke={color.muted} />}
                                            variant="bare"
                                            tone="muted"
                                            onPress={() => setDeletingPayment(payment)}
                                            testID={`visit-view-payment-remove-${index}`}
                                        />
                                    </View>
                                ))}
                            </View>
                        )}

                        <View style={styles.total}>
                            <View style={styles.totalLabel}>
                                <View style={[styles.dot, settled ? styles.dotSettled : styles.dotDue]} />
                                <Text variant="subhead" tone="muted">
                                    {t(settled ? 'Paid in full' : 'Remaining balance')}
                                </Text>
                            </View>
                            <Text
                                variant="headline"
                                script="mono"
                                weight="bold"
                                tone={settled ? 'success' : 'due'}
                            >
                                {formatMoney(settled ? (visit.chargedTotal ?? 0) : (visit.balance ?? 0))}
                            </Text>
                        </View>
                    </>
                )}
            </ScrollView>

            {priced ? (
                <View style={styles.bar}>
                    <Button label="Edit visit" block onPress={() => onEdit(visit)} testID="visit-view-edit" />
                </View>
            ) : null}

            <PopoverMenu
                visible={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchor={{ top: menuTop, end: space[4] }}
                items={[
                    {
                        key: 'delete',
                        label: t('Delete visit'),
                        icon: <TrashIcon size={16} stroke={color.danger} />,
                        danger: true,
                        onPress: () => {
                            setMenuOpen(false);
                            // Refused by the server too; saying so here spares
                            // the confirm for something that cannot happen.
                            if (payments && payments.length > 0) {
                                setToast(
                                    t(
                                        'This visit has payments on it. Remove them first if they were entered by mistake.',
                                    ),
                                );
                                return;
                            }
                            setDeletingVisit(true);
                        },
                    },
                ]}
            />

            <ConfirmSheet
                visible={deletingVisit}
                title="Delete this visit?"
                body={
                    appointment.channel === 'walk_in'
                        ? 'The visit and the walk-in it was made for are removed. This cannot be undone.'
                        : 'What was done is removed and the appointment goes back to booked. This cannot be undone.'
                }
                confirmLabel="Delete visit"
                onConfirm={confirmDeleteVisit}
                onCancel={() => setDeletingVisit(false)}
                destructive
                loading={deleteVisit.pending}
                testID="visit-view-delete-confirm"
            />

            <ConfirmSheet
                visible={deletingPayment !== null}
                title="Remove this payment?"
                body="Only for a payment that was never taken. One taken at the wrong figure is corrected from Edit visit, and both entries stay on the record."
                detail={
                    deletingPayment ? (
                        <Text variant="headline" script="mono" weight="bold" style={styles.confirmAmount}>
                            {formatMoney(deletingPayment.amount)}
                        </Text>
                    ) : null
                }
                confirmLabel="Remove payment"
                onConfirm={confirmDeletePayment}
                onCancel={() => setDeletingPayment(null)}
                destructive
                loading={deletePayment.pending}
                testID="visit-view-payment-delete-confirm"
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
    // The chip sizes itself; the row is only what holds it off the line above.
    chipRow: { flexDirection: 'row', marginTop: space[1] },

    totalLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2.5] },
    dot: { width: 7, height: 7, borderRadius: radius.full },
    dotSettled: { backgroundColor: color.success },
    dotDue: { backgroundColor: color.due },

    tabs: { paddingHorizontal: size.gutter, paddingTop: space[4], paddingBottom: space[1] },

    scroll: { flex: 1 },
    body: { paddingBottom: space[8] },

    sectionHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: size.gutter,
        paddingTop: space[4],
        paddingBottom: space[2.5],
    },
    blank: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    grow: { flex: 1, minWidth: 0 },
    waivedNote: { marginTop: space[1] },
    note: {
        gap: space[1.5],
        marginHorizontal: size.gutter,
        padding: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },

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
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
    },

    payments: { paddingHorizontal: size.gutter },
    confirmAmount: { marginTop: space[3] },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingVertical: space[3],
    },
    dateRowDivided: { borderTopWidth: border.hair, borderTopColor: color.hair },
    stamp: { width: 46, alignItems: 'center', justifyContent: 'center', gap: 1 },

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

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    bar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3.5],
        // The tab bar is below this again and owns the gesture inset, so the
        // bar only needs its own breathing room — `space[6]` left the button
        // floating well clear of the tabs.
        paddingBottom: space[4],
        backgroundColor: color.canvas,
    },
});
