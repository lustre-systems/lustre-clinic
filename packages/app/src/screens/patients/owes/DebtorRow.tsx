// One row of the "Owes money" filter on the Patients list. The amount is the standing balance
// across every visit, as `balance.outstanding` derived it — the row never adds
// anything up. How long it has been owed is the only part of the line the
// design colours, under an hourglass rather than "Outstanding for" on every
// row; the full phrase stays in the row's label for a screen reader. Entry animates only on mount; re-running on a filter change
// would restage the whole list on every search keystroke.
// biome-ignore lint/style/noRestrictedImports: runs the staggered entry `Animated.timing` on mount and stops it on cleanup
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { formatMoney } from '../../../components/domain';
import { Chevron, duration, easing, useReducedMotion } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, space, Text } from '../../../theme';
import { MoneyValue } from '../../stats/MoneyValue';
import type { PatientBalance } from './data';
import { outstandingAge } from './debtors';
import { OwedForIcon } from './icons';

const MAX_STAGGER_STEPS = 8;
const STAGGER_MS = 32;
const ROW_HEIGHT = 64;

export type DebtorRowProps = {
    patient: PatientBalance;
    index: number;
    onPress: () => void;
};

export function DebtorRow({ patient, index, onPress }: DebtorRowProps) {
    const t = useT();
    const entry = useRef(new Animated.Value(0)).current;
    const reducedMotion = useReducedMotion();
    const age = outstandingAge(patient.oldestUnpaidAt);

    useEffect(() => {
        const animation = Animated.timing(entry, {
            toValue: 1,
            duration: reducedMotion ? 0 : duration.fadeup,
            delay: reducedMotion ? 0 : Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS,
            easing: easing.standard,
            useNativeDriver: true,
        });

        animation.start();
        return () => animation.stop();
    }, [entry, reducedMotion, index]);

    return (
        <Animated.View
            style={{
                opacity: entry,
                transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
            }}
        >
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={`${patient.name}, ${t('Outstanding for')} ${age}, ${formatMoney(patient.balance)}`}
                style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}
                testID={`owes-debtor-${patient.patientId}`}
            >
                <View style={styles.text}>
                    <Text variant="body" weight="semibold" numberOfLines={1}>
                        {patient.name}
                    </Text>

                    <View style={styles.age}>
                        <OwedForIcon />
                        <Text variant="footnote" weight="semibold" tone="due">
                            {age}
                        </Text>
                    </View>
                </View>

                <MoneyValue amount={patient.balance} variant="body" weight="bold" tone="due" />
                <Chevron size={7} />
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: ROW_HEIGHT,
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        backgroundColor: color.surface,
    },
    divided: { borderTopWidth: 1, borderTopColor: color.hair },
    // `flex-start` for the reason `domain/PatientRow` gives: a stretched line
    // aligns a Latin name by its own script, off the row's start edge in Arabic.
    text: { flex: 1, minWidth: 0, gap: space[0.5], alignItems: 'flex-start' },
    age: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
    pressed: { backgroundColor: color.canvas },
});
