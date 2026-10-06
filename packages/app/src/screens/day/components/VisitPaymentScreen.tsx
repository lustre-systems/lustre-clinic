/**
 * Money, and only money — `visit-payment.html`. By the time this opens the
 * procedures are confirmed and written; nothing here edits treatment, which is
 * why the procedure list is a disclosure rather than an editor. The visit
 * screen is one Back away if a line is wrong.
 *
 * Balances are per visit (the payment brief's Q1): this screen settles *this*
 * visit and nothing else. An older debt is paid by opening the visit that
 * carries it, so there is no combined total here and no way to pay one visit's
 * money into another.
 *
 * Overpayment is refused rather than rejected on submit (§7.6, Q2): a cash
 * clinic has no refund workflow, so the entry clamps to the amount due and says
 * it did. Paying nothing is *not* refused — an unpaid visit is a balance, not a
 * blocked checkout — so the confirm button never blocks and only ever changes
 * what it says it is about to record.
 *
 * A doctor's phone is not told what was paid (`seesPayments`): the visit comes
 * with its payment fields withheld. It can still check the patient out and take
 * money at the chair, against the charge, but it cannot correct what was taken
 * before — that needs the figure it is not shown — and what it says afterwards
 * does not claim to know the balance.
 *
 * The design's identity line names the dentist. Lustre does not model one
 * (PRD §10 leaves a second practitioner undecided), so the line carries the
 * date alone.
 */
import { PAYMENT_METHODS, type PaymentMethod, PIASTRES_PER_POUND } from '@lustre/shared';
import { useMemo, useState } from 'react';
import type { ViewStyle } from 'react-native';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { formatMoney, MethodIcon } from '../../../components/domain';
import { Button, Callout, Chevron, Sheet, Toast, useKeyboardHeight } from '../../../components/ui';
import { useIsRTL, useT } from '../../../i18n';
import { border, color, font, radius, size, space, Text, type } from '../../../theme';
import { type Appointment, api, closeVisit, useLocalMutation, useLocalQuery } from '../data';
import { describeError } from '../errors';
import {
    amountDue,
    discountPercent,
    formatAmount,
    type PricedVisit,
    poundsEntry,
    procedureDiscount,
} from '../money';
import { dateKey, dayOfMonth, formatLongDate, monthShort } from '../time';
import { CheckIcon } from './icons';

export type VisitPaymentScreenProps = {
    appointment: Appointment;
    /** Priced by the visit screen — `chargedTotal` is what this screen collects. */
    visit: PricedVisit;
    /**
     * The visit was checked out once already and is being corrected. The field
     * then means everything collected on it, not a payment on top: a visit
     * recorded as paid in full offers nothing to collect, and typing 500 over
     * the 800 on it has to be able to *lower* the figure. Off, this is a desk
     * taking money, and the field is what is being handed over now.
     */
    correcting?: boolean;
    onBack: () => void;
    /** The visit is closed; the day view takes it from here. */
    onClosed: (message: string) => void;
    /**
     * The money is being written. The caller holds the hardware back for the
     * span, because a correction is two writes and leaving between them strands
     * a reopened visit.
     */
    onWritingChange?: (writing: boolean) => void;
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
    cash: 'Cash',
    visa: 'Card',
    instapay: 'Instapay',
    other: 'Other',
};

function toPiastres(pounds: string): number {
    const digits = poundsEntry(pounds);
    return digits ? Number(digits) * PIASTRES_PER_POUND : 0;
}

function toPounds(piastres: number): string {
    return String(Math.round(piastres / PIASTRES_PER_POUND));
}

export function VisitPaymentScreen({
    appointment,
    visit,
    correcting: asked = false,
    onBack,
    onClosed,
    onWritingChange,
}: VisitPaymentScreenProps) {
    const t = useT();
    const isRTL = useIsRTL();
    const keyboard = useKeyboardHeight();
    const withheld = visit.paidTotal === null;
    const correcting = asked && !withheld;
    const collected = visit.paidTotal ?? 0;
    // There is no discount to type here: a discount is a procedure priced under
    // the catalogue's on the visit screen, and this only says how much that is.
    const charged = visit.chargedTotal;
    const catalogue = useLocalQuery('procedure-tree', api.procedureTree);
    const defaults = useMemo(() => {
        const map = new Map<string, number>();
        for (const category of catalogue.data ?? []) {
            map.set(category.id, category.defaultPrice);
            for (const child of category.children) map.set(child.id, child.defaultPrice);
        }
        return map;
    }, [catalogue.data]);
    const discount = useMemo(
        () => procedureDiscount(visit.procedures, defaults),
        [visit.procedures, defaults],
    );
    const lineDiscount = (line: PricedVisit['procedures'][number]) =>
        discountPercent(defaults.get(line.procedureId) ?? 0, line.unitPrice);
    // Withheld, a visit already closed offers nothing to take: whatever it was
    // paid is on it, and taking the charge again would be taking it twice.
    const due = withheld ? (visit.completedAt ? 0 : charged) : amountDue(charged, collected);
    // What the field means, and so the most it can hold: money being taken now
    // cannot exceed what is owed, but a *total* collected is measured against
    // the whole charge — which is the figure a correction has to be free to
    // move up and down.
    const ceiling = correcting ? charged : due;

    // The mock opens on the full amount, already filled in: paid in full is what
    // happens at the desk almost every time, and the exception is the one worth
    // typing. A correction opens on what is already recorded, for the same
    // reason — most corrections are to the procedures, not the money.
    const [paid, setPaid] = useState(() => toPounds(correcting ? collected : due));
    const [method, setMethod] = useState<PaymentMethod>('cash');
    const [methodNote, setMethodNote] = useState('');
    const [showProcedures, setShowProcedures] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [done, setDone] = useState<Done | null>(null);

    const checkOut = useLocalMutation(closeVisit);
    const setPaidTotal = useLocalMutation(api.setPaid);

    const paidPiastres = toPiastres(paid);
    const remaining = Math.max(ceiling - paidPiastres, 0);
    const settled = remaining === 0;
    const nothing = paidPiastres === 0;

    // Full, Half and Nothing are about the money still owed, in both modes. At
    // the desk the field is that money and they read straight off it. On a
    // correction the field is a running total, so they read off what is left on
    // top of it: half of a 6,000 visit with 150 on it is the 150 plus half of
    // the 5,850 outstanding, not half the bill.
    const base = correcting ? collected : 0;
    const room = Math.max(ceiling - base, 0);
    // What this confirm actually moves — the whole field at the desk, only the
    // difference on a correction. Negative is money going back.
    const moving = paidPiastres - base;
    // Whether any money actually moves. On a correction only the difference
    // does — leaving the figure alone writes nothing, so there is no method to
    // ask for; changing it does move money, even when the new figure is zero,
    // because that is a refund of everything.
    const moves = moving !== 0;
    const noteMissing = moves && method === 'other' && methodNote.trim() === '';

    function setPaidClamped(entry: string) {
        const digits = poundsEntry(entry);
        if (toPiastres(digits) > ceiling) {
            setPaid(toPounds(ceiling));
            setToast(
                t(
                    correcting
                        ? 'They cannot have paid more than the visit charges'
                        : 'They cannot pay more than the amount due',
                ),
            );
            return;
        }
        setPaid(digits);
    }

    function methodText(): string {
        if (method !== 'other') return t(METHOD_LABEL[method]).toLowerCase();
        return methodNote.trim() ? methodNote.trim().toLowerCase() : t('other method').toLowerCase();
    }

    /**
     * A correction settles the money first and then closes the visit on the
     * same charge. `setPaid` writes only the difference — nothing at all when
     * there is none — so the checkout that follows takes no payment of its own.
     */
    function confirm() {
        if (checkOut.pending || setPaidTotal.pending) return;
        onWritingChange?.(true);
        if (!correcting) {
            close(paidPiastres);
            return;
        }

        setPaidTotal.mutate(
            {
                visitId: visit.id,
                paidTotal: paidPiastres,
                method,
                methodNote: method === 'other' ? methodNote.trim() : null,
            },
            { onSuccess: () => close(0), onError: () => onWritingChange?.(false) },
        );
    }

    /** `paying` is money handed over now, which a correction has already done. */
    function close(paying: number) {
        checkOut.mutate(
            {
                visitId: visit.id,
                closed: visit.completedAt !== null,
                chargedTotal: charged,
                paidTotal: paying,
                method,
                methodNote: method === 'other' ? methodNote.trim() : null,
            },
            {
                onError: () => onWritingChange?.(false),
                onSuccess: (closed) => {
                    onWritingChange?.(false);
                    const balance = closed.balance;
                    if (balance === null) {
                        setDone({
                            tone: nothing ? 'none' : 'settled',
                            title: t('Visit closed'),
                            message: nothing
                                ? t('No payment recorded here.')
                                : t('{amount} {method} recorded.', {
                                      amount: formatMoney(paidPiastres),
                                      method: methodText(),
                                  }),
                            toast: nothing
                                ? t('Checked out')
                                : t('Checked out · {amount} recorded', { amount: formatMoney(paidPiastres) }),
                        });
                        return;
                    }
                    if (correcting) {
                        setDone({
                            tone: balance > 0 ? 'owing' : 'settled',
                            title: t('Visit updated'),
                            message:
                                balance > 0
                                    ? t('{amount} paid — {balance} still owed on this visit.', {
                                          amount: formatMoney(paidPiastres),
                                          balance: formatMoney(balance),
                                      })
                                    : t('{amount} paid. Nothing left on this visit.', {
                                          amount: formatMoney(paidPiastres),
                                      }),
                            toast:
                                balance > 0
                                    ? t('Visit updated · {balance} outstanding', {
                                          balance: formatMoney(balance),
                                      })
                                    : t('Visit updated · settled in full'),
                        });
                        return;
                    }
                    if (nothing) {
                        setDone({
                            tone: 'none',
                            title: t('Visit closed'),
                            message: t('No payment recorded — {balance} outstanding on this visit.', {
                                balance: formatMoney(balance),
                            }),
                            toast: t('Checked out · {balance} outstanding', {
                                balance: formatMoney(balance),
                            }),
                        });
                        return;
                    }
                    if (balance > 0) {
                        setDone({
                            tone: 'owing',
                            title: t('Visit closed'),
                            message: t('{amount} {method} — {balance} still owed on this visit.', {
                                amount: formatMoney(paidPiastres),
                                method: methodText(),
                                balance: formatMoney(balance),
                            }),
                            toast: t('Checked out · {balance} outstanding', {
                                balance: formatMoney(balance),
                            }),
                        });
                        return;
                    }
                    setDone({
                        tone: 'settled',
                        title: t('Paid in full'),
                        message: t('{amount} {method}. Nothing left on this visit.', {
                            amount: formatMoney(due),
                            method: methodText(),
                        }),
                        toast: t('Checked out · settled in full'),
                    });
                },
            },
        );
    }

    const confirmLabel = withheld
        ? nothing
            ? t('Close visit without payment')
            : t('Confirm & close visit')
        : correcting
          ? settled
              ? t('Save & close visit')
              : t('Save — {balance} still owed', { balance: formatMoney(remaining) })
          : nothing
            ? t('Close visit without payment')
            : settled
              ? t('Confirm & close visit')
              : t('Confirm — {balance} still owed', { balance: formatMoney(remaining) });

    /**
     * The method belongs to the money moving now, not to the visit. A patient
     * who paid 150 in cash and the rest by Instapay is two payment rows, and
     * the screen only ever writes the second of them — so it says which amount
     * it is asking about, and that the first keeps what it was paid by.
     */
    const methodHint = !moves
        ? correcting
            ? t('Unchanged — no money moves either way.')
            : t('Nothing collected — the full amount stays on this visit.')
        : moving < 0
          ? t('{amount} given back. What stays paid keeps how it was paid.', {
                amount: formatMoney(-moving),
            })
          : correcting && collected > 0
            ? t('{amount} collected now. The {collected} already on this visit keeps how it was paid.', {
                  amount: formatMoney(moving),
                  collected: formatMoney(collected),
              })
            : '';

    const writeError = setPaidTotal.error ?? checkOut.error;
    const failure = writeError ? describeError(writeError, 'check-out') : null;
    const day = dateKey(appointment.startsAt);

    return (
        <View style={styles.screen} testID="visit-payment-screen">
            <View style={styles.topbar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Back to the visit')}
                    // A correction is two writes, the money and then the close;
                    // leaving between them strands a reopened visit.
                    disabled={checkOut.pending || setPaidTotal.pending}
                    onPress={onBack}
                    style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
                >
                    <Chevron direction="back" size={10} tone="ink" />
                </Pressable>
                <Text variant="eyebrow" tone="muted">
                    {t('PAYMENT')}
                </Text>
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.body}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.identity}>
                    <View style={styles.tile}>
                        <Text variant="title3" script="sans" weight="semibold" tone="inverse">
                            {dayOfMonth(day)}
                        </Text>
                        <Text variant="tag" tone="inverse" style={styles.tileMonth}>
                            {monthShort(day).toUpperCase()}
                        </Text>
                    </View>

                    <View style={styles.who}>
                        <Text variant="title2" weight="bold" numberOfLines={2}>
                            {appointment.patient.name}
                        </Text>
                        <Text variant="subhead" tone="muted">
                            {formatLongDate(day)}
                        </Text>
                    </View>
                </View>

                <View style={styles.dueCard}>
                    <Text variant="eyebrow" tone="muted">
                        {t(correcting ? 'TOTAL CHARGED' : 'AMOUNT DUE')}
                    </Text>
                    <View style={styles.figure}>
                        <Text variant="footnote" weight="bold" tone="muted">
                            {t('EGP')}
                        </Text>
                        {/* A procedure priced under the catalogue's: what it
                            would have been, struck through, then what it is. */}
                        {discount ? (
                            <Text
                                variant="headline"
                                script="mono"
                                tone="muted"
                                style={styles.struck}
                                accessibilityLabel={t('Usually {amount}', {
                                    amount: formatMoney(ceiling + discount.off),
                                })}
                            >
                                {formatAmount(ceiling + discount.off)}
                            </Text>
                        ) : null}
                        <Text variant="display" script="mono">
                            {formatAmount(ceiling)}
                        </Text>
                        {discount ? (
                            <View style={styles.percentOff} testID="visit-payment-discount">
                                <Text
                                    variant="footnote"
                                    weight="bold"
                                    script="mono"
                                    style={styles.percentOffText}
                                >
                                    {t('-{percent}%', {
                                        percent:
                                            discountPercent(ceiling + discount.off, ceiling) ??
                                            discount.percent,
                                    })}
                                </Text>
                            </View>
                        ) : null}
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: showProcedures }}
                        onPress={() => setShowProcedures((current) => !current)}
                        style={styles.procToggle}
                        testID="visit-payment-procedures"
                    >
                        <Text
                            variant="footnote"
                            weight="medium"
                            tone={showProcedures ? 'ink2' : 'muted'}
                            style={styles.grow}
                        >
                            {t(visit.procedures.length === 1 ? '{count} procedure' : '{count} procedures', {
                                count: visit.procedures.length,
                            })}
                        </Text>
                        <Chevron direction={showProcedures ? 'up' : 'down'} size={8} tone="muted" />
                    </Pressable>

                    {showProcedures ? (
                        <View style={styles.procList}>
                            {visit.procedures.map((line, index) => (
                                <View key={line.id} style={[styles.procRow, index > 0 && styles.procDivided]}>
                                    <View style={styles.toothBadge}>
                                        <Text variant="footnote" weight="bold">
                                            {line.tooth ?? '—'}
                                        </Text>
                                        <Text variant="tag" tone="muted" style={styles.toothCaption}>
                                            {t('TOOTH')}
                                        </Text>
                                    </View>

                                    <View style={styles.grow}>
                                        <Text variant="callout" weight="semibold">
                                            {line.quantity > 1
                                                ? `${line.name} × ${line.quantity}`
                                                : line.name}
                                        </Text>
                                    </View>

                                    {lineDiscount(line) !== null ? (
                                        <Text
                                            variant="footnote"
                                            script="mono"
                                            tone="muted"
                                            style={styles.struck}
                                            accessibilityLabel={t('Usually {amount}', {
                                                amount: formatMoney(
                                                    (defaults.get(line.procedureId) ?? 0) * line.quantity,
                                                ),
                                            })}
                                        >
                                            {formatAmount(
                                                (defaults.get(line.procedureId) ?? 0) * line.quantity,
                                            )}
                                        </Text>
                                    ) : null}
                                    <Text variant="callout" script="mono" weight="semibold">
                                        {formatAmount(line.lineTotal)}
                                    </Text>
                                    {lineDiscount(line) !== null ? (
                                        <View style={[styles.percentOff, styles.percentOffSmall]}>
                                            <Text
                                                variant="tag"
                                                weight="bold"
                                                script="mono"
                                                style={styles.percentOffText}
                                            >
                                                {t('-{percent}%', { percent: lineDiscount(line) ?? 0 })}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>
                            ))}
                        </View>
                    ) : null}
                </View>

                <Text variant="eyebrow" tone="muted" style={styles.secLabel}>
                    {t(correcting ? 'TOTAL PAID' : 'AMOUNT PAID')}
                </Text>
                <View style={styles.paidField}>
                    <Text variant="footnote" weight="bold" tone="muted">
                        {t('EGP')}
                    </Text>
                    <TextInput
                        value={paid}
                        onChangeText={setPaidClamped}
                        keyboardType="decimal-pad"
                        accessibilityLabel={t('Amount paid')}
                        selectTextOnFocus
                        style={[styles.paidInput, { textAlign: isRTL ? 'left' : 'right' }]}
                        testID="visit-payment-amount"
                    />
                </View>

                {correcting ? (
                    <Text variant="footnote" tone="muted" style={styles.hint}>
                        {t('Everything paid on this visit, not a payment on top of it.')}
                    </Text>
                ) : null}

                <View style={styles.quick}>
                    <QuickChip
                        label="Full"
                        selected={paidPiastres === base + room && room > 0}
                        onPress={() => setPaidClamped(toPounds(base + room))}
                    />
                    <QuickChip
                        label="Half"
                        selected={paidPiastres === base + Math.round(room / 2) && room > 0}
                        onPress={() => setPaidClamped(toPounds(base + Math.round(room / 2)))}
                    />
                    <QuickChip
                        label="Nothing"
                        selected={paidPiastres === base}
                        onPress={() => setPaidClamped(toPounds(base))}
                    />
                </View>

                <View style={moves ? undefined : styles.methodsOff} pointerEvents={moves ? 'auto' : 'none'}>
                    <Text variant="eyebrow" tone="muted" style={styles.secLabel}>
                        {t(moving < 0 ? 'GIVEN BACK BY' : 'PAID BY')}
                    </Text>
                    <View style={styles.methods}>
                        {PAYMENT_METHODS.map((option) => {
                            const on = method === option;

                            return (
                                <Pressable
                                    key={option}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: on }}
                                    onPress={() => setMethod(option)}
                                    style={({ pressed }) => [
                                        styles.method,
                                        on && styles.methodOn,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <MethodIcon
                                        method={option}
                                        size={20}
                                        stroke={on ? color.ink : color.ink2}
                                    />
                                    <Text variant="callout" weight="medium">
                                        {t(METHOD_LABEL[option])}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {method === 'other' && moves ? (
                        <View style={styles.otherWrap}>
                            <TextInput
                                value={methodNote}
                                onChangeText={setMethodNote}
                                placeholder={t('How was it paid?')}
                                placeholderTextColor={color.muted}
                                accessibilityLabel={t('Other payment method')}
                                style={[styles.otherInput, noteMissing && styles.otherInputMissing]}
                            />
                        </View>
                    ) : null}
                </View>

                {methodHint ? (
                    <Text variant="footnote" tone="muted" style={styles.methodNote}>
                        {methodHint}
                    </Text>
                ) : null}

                {/* Worked out from the charge alone, which is wrong the moment
                    anything was paid before — and a doctor's phone is not told
                    whether it was. So it says nothing about what is owed. */}
                {withheld ? null : (
                    <View style={styles.strip}>
                        {settled ? (
                            <CheckIcon size={15} stroke={color.success} width={3} />
                        ) : (
                            <View style={styles.stripDot} />
                        )}
                        <Text variant="subhead" tone="muted">
                            {t(settled ? 'Settled — nothing owed' : 'Remaining balance')}
                        </Text>
                        <Text
                            variant="headline"
                            script="mono"
                            weight="bold"
                            tone={settled ? 'success' : 'due'}
                            style={styles.stripAmount}
                        >
                            {formatMoney(remaining)}
                        </Text>
                    </View>
                )}
            </ScrollView>

            {failure ? (
                <View style={styles.notice}>
                    <Callout tone="warning" title={failure.title}>
                        {failure.body ?? ''}
                    </Callout>
                </View>
            ) : null}

            <View style={[styles.bar, { paddingBottom: Math.max(space[4], keyboard) }]}>
                <Button
                    label={confirmLabel}
                    block
                    loading={checkOut.pending || setPaidTotal.pending}
                    disabled={noteMissing}
                    onPress={confirm}
                    testID="visit-payment-confirm"
                />
            </View>

            <Sheet
                visible={done !== null}
                onClose={() => done && onClosed(done.toast)}
                dismissable={false}
                testID="visit-closed-sheet"
                footer={
                    <Button
                        label="Back to day view"
                        block
                        onPress={() => done && onClosed(done.toast)}
                        testID="visit-payment-back-to-day"
                    />
                }
            >
                <View style={styles.doneBody}>
                    <View style={[styles.doneRing, done ? RING_STYLE[done.tone] : null]}>
                        <CheckIcon size={28} stroke={done ? RING_TONE[done.tone] : color.success} />
                    </View>
                    <Text variant="title2" weight="bold">
                        {done?.title ?? ''}
                    </Text>
                    <Text variant="callout" tone="muted" style={styles.doneMessage}>
                        {done?.message ?? ''}
                    </Text>
                </View>
            </Sheet>

            <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
        </View>
    );
}

type DoneTone = 'settled' | 'owing' | 'none';

/** What the closing sheet says, plus the shorter line the day view toasts. */
type Done = { tone: DoneTone; title: string; message: string; toast: string };

function QuickChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    const t = useT();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.quickChip,
                selected && styles.quickChipOn,
                pressed && styles.pressed,
            ]}
        >
            <Text variant="subhead" weight="semibold" tone={selected ? 'inverse' : 'ink2'}>
                {t(label)}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    // Canvas, matching `VisitScreen` and the shell's status-bar inset — see the
    // note there. The cards on it keep their white.
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

    scroll: { flex: 1 },
    body: { paddingBottom: space[8] },

    identity: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3.5],
        paddingHorizontal: size.gutter,
        paddingTop: space[3.5],
        paddingBottom: space[4],
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
    who: { flex: 1, minWidth: 0, gap: space[1] },

    dueCard: {
        marginHorizontal: size.gutter,
        paddingTop: space[4],
        paddingHorizontal: space[4],
        paddingBottom: space[1.5],
        borderRadius: radius.xl2,
        // `surface2` where the mock says `canvas` — the page is canvas now.
        backgroundColor: color.surface2,
        overflow: 'hidden',
    },
    figure: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: space[1.5],
        marginTop: space[2],
    },
    struck: { textDecorationLine: 'line-through' },
    // Accent, which is neither "good" nor "paid": a discount is a fact about
    // the price, not a state of the money.
    percentOff: {
        alignSelf: 'center',
        paddingHorizontal: space[2.5],
        paddingVertical: space[1],
        borderRadius: radius.full,
        backgroundColor: color.accent,
    },
    percentOffText: { color: color.inverse },
    percentOffSmall: { paddingHorizontal: space[1.5], paddingVertical: space[0.5] },
    // Full-bleed inside the card: the rule under the figure is the card's own
    // width, not the text column's.
    procToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        minHeight: size.row,
        marginTop: space[2.5],
        marginHorizontal: -space[4],
        paddingHorizontal: space[4],
        borderTopWidth: border.hair,
        borderTopColor: color.line,
    },
    procList: { paddingTop: space[0.5], paddingBottom: space[3] },
    procRow: { flexDirection: 'row', alignItems: 'center', gap: space[2.5], paddingVertical: space[2] },
    procDivided: { borderTopWidth: border.hair, borderTopColor: color.line },
    toothBadge: {
        width: 42,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        paddingVertical: space[1],
        borderRadius: radius.md,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    toothCaption: { fontSize: 7.5, letterSpacing: 0.9 },
    grow: { flex: 1, minWidth: 0 },

    secLabel: { marginTop: space[6], marginBottom: space[2], marginHorizontal: size.gutter },

    paidField: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        height: 62,
        marginHorizontal: size.gutter,
        paddingHorizontal: space[4],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    paidInput: {
        flex: 1,
        minWidth: 0,
        padding: 0,
        color: color.ink,
        ...type.figure,
        fontFamily: font.mono.medium,
    },

    quick: {
        flexDirection: 'row',
        gap: space[2],
        marginTop: space[2.5],
        marginHorizontal: size.gutter,
    },
    quickChip: {
        flex: 1,
        minHeight: size.row,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    quickChipOn: { borderColor: color.ink, backgroundColor: color.ink },

    methodsOff: { opacity: 0.4 },
    methods: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: space[2],
        marginHorizontal: size.gutter,
    },
    method: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        // Two to a row: 48% leaves room for the gap, and `flexGrow` takes the
        // remainder back so the pair fills the width exactly.
        flexBasis: '48%',
        flexGrow: 1,
        minHeight: 56,
        paddingHorizontal: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    methodOn: { borderColor: color.ink, borderWidth: border.thick, backgroundColor: color.surface2 },

    otherWrap: { marginTop: space[2], marginHorizontal: size.gutter },
    otherInput: {
        minHeight: size.row,
        paddingHorizontal: space[3.5],
        paddingVertical: space[2],
        borderRadius: radius.md,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
        color: color.ink,
        ...type.callout,
        fontFamily: font.sans.regular,
    },
    otherInputMissing: { borderColor: color.due },

    methodNote: { marginTop: space[2], marginHorizontal: size.gutter },
    // Sits under the field, tight to it — it is a caption on the number above,
    // not a section of its own.
    hint: { marginTop: space[2], marginHorizontal: size.gutter },

    strip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        marginTop: space[6],
        marginHorizontal: size.gutter,
        paddingVertical: space[3.5],
        borderTopWidth: border.hair,
        borderTopColor: color.hair,
        borderBottomWidth: border.hair,
        borderBottomColor: color.hair,
    },
    stripDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: color.due },
    stripAmount: { marginStart: 'auto' },

    doneBody: { alignItems: 'center', gap: space[1.5], paddingTop: space[3] },
    doneRing: {
        width: 60,
        height: 60,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        marginBottom: space[2.5],
    },
    doneSettled: { backgroundColor: color.successSoft },
    doneOwing: { backgroundColor: color.dueSoft },
    doneNone: { backgroundColor: color.surface2 },
    doneMessage: { textAlign: 'center', maxWidth: 260, marginBottom: space[2] },

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    bar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3.5],
        // The tab bar is below this again and owns the gesture inset, so the
        // bar only needs its own breathing room — `space[6]` left the button
        // floating well clear of the tabs. `paddingBottom` is supplied inline:
        // it carries the keyboard as well, since the window no longer shrinks
        // around it (see `ui/useKeyboardHeight`), and this screen's amount
        // field is the one that first showed it.
        //
        // The same ground as the page. The mock fades its bar into the page
        // rather than sitting a panel on it, so a white bar on canvas read as
        // a seam across the bottom of the screen.
        backgroundColor: color.canvas,
    },
    pressed: { opacity: 0.72 },
});

const RING_STYLE: Record<DoneTone, ViewStyle> = {
    settled: styles.doneSettled,
    owing: styles.doneOwing,
    none: styles.doneNone,
};

const RING_TONE: Record<DoneTone, string> = {
    settled: color.success,
    owing: color.due,
    none: color.muted,
};
