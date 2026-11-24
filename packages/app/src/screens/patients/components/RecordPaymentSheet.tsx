import { PAYMENT_METHODS, type PaymentMethod } from '@lustre/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatMoney, MethodIcon, MoneyValue } from '../../../components/domain';
import { Button, Callout, Chip, NumericField, Sheet, TextField } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, space, Text } from '../../../theme';
import type { SettleInput } from '../data/types';
import { clampToOutstanding, isWholePounds, methodLabel, toPounds } from './money';

export type RecordPaymentSheetProps = {
    visible: boolean;
    onClose: () => void;
    patientId: string;
    outstanding: number;
    isPending: boolean;
    error: string | null;
    onSubmit: (input: SettleInput) => void;
};

export function RecordPaymentSheet({
    visible,
    onClose,
    patientId,
    outstanding,
    isPending,
    error,
    onSubmit,
}: RecordPaymentSheetProps) {
    const t = useT();
    const duePounds = toPounds(outstanding);

    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<PaymentMethod>('cash');
    const [note, setNote] = useState('');
    const [notice, setNotice] = useState<string | null>(null);

    const [wasVisible, setWasVisible] = useState(visible);
    if (visible !== wasVisible) {
        setWasVisible(visible);
        if (visible) {
            setAmount('');
            setMethod('cash');
            setNote('');
            setNotice(null);
        }
    }

    function changeAmount(text: string) {
        if (!isWholePounds(text)) {
            setNotice(t('Whole pounds only — piastres are not recorded.'));
            return;
        }

        const entered = text === '' ? 0 : Number(text);

        if (entered > duePounds) {
            setAmount(String(duePounds));
            setNotice(
                t('That is more than they owe. They owe {amount}.', { amount: formatMoney(outstanding) }),
            );
            return;
        }

        setNotice(null);
        setAmount(text);
    }

    const enteredPounds = amount === '' ? 0 : Number(amount);
    const noteMissing = method === 'other' && note.trim() === '';
    const canSubmit = enteredPounds > 0 && !noteMissing;

    function submit() {
        if (!canSubmit) return;

        onSubmit({
            patientId,
            amount: clampToOutstanding(enteredPounds, outstanding),
            method,
            methodNote: method === 'other' ? note.trim() : null,
        });
    }

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title="Record a payment"
            dismissable={!isPending}
            testID="record-payment-sheet"
            footer={
                <Button
                    label="Record payment"
                    onPress={submit}
                    loading={isPending}
                    disabled={!canSubmit}
                    block
                    testID="record-payment-submit"
                />
            }
        >
            <View style={styles.due}>
                <Text variant="subhead" tone="muted">
                    {t('Outstanding')}
                </Text>
                <MoneyValue piastres={outstanding} variant="amount" tone="due" weight="bold" />
            </View>

            <NumericField
                label="Amount paid"
                variant="display"
                prefix={t('EGP')}
                placeholder="0"
                keyboardType="number-pad"
                value={amount}
                onChangeText={changeAmount}
                editable={!isPending}
                testID="record-payment-amount"
            />

            {notice ? (
                <View accessibilityLiveRegion="assertive" style={styles.notice}>
                    <Callout tone="warning">
                        <Text variant="subhead" tone="due">
                            {notice}
                        </Text>
                    </Callout>
                </View>
            ) : null}

            <View style={styles.quick}>
                <Chip
                    label="Full"
                    selected={enteredPounds === duePounds && duePounds > 0}
                    onPress={() => changeAmount(String(duePounds))}
                    disabled={isPending}
                    grow
                />
                <Chip
                    label="Half"
                    selected={enteredPounds > 0 && enteredPounds === Math.floor(duePounds / 2)}
                    onPress={() => changeAmount(String(Math.floor(duePounds / 2)))}
                    disabled={isPending}
                    grow
                />
            </View>

            <View style={styles.methods}>
                {PAYMENT_METHODS.map((option) => (
                    <Chip
                        key={option}
                        label={methodLabel(option)}
                        icon={
                            <MethodIcon
                                method={option}
                                size={16}
                                stroke={option === method ? color.inverse : color.ink2}
                            />
                        }
                        selected={option === method}
                        onPress={() => setMethod(option)}
                        disabled={isPending}
                        grow
                        testID={`record-payment-method-${option}`}
                    />
                ))}
            </View>

            {method === 'other' ? (
                <TextField
                    label="What was it?"
                    required
                    placeholder="Bank transfer"
                    value={note}
                    onChangeText={setNote}
                    editable={!isPending}
                />
            ) : null}

            {error ? (
                <Callout tone="warning" title="The payment was not recorded">
                    <Text variant="subhead" tone="due">
                        {error}
                    </Text>
                </Callout>
            ) : null}
        </Sheet>
    );
}

const styles = StyleSheet.create({
    due: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3] },
    notice: { alignSelf: 'stretch' },
    quick: { flexDirection: 'row', gap: space[2] },
    methods: { flexDirection: 'row', gap: space[2] },
});
