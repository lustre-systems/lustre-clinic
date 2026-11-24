// biome-ignore lint/style/noRestrictedImports: starts a Reanimated timing when the count changes — an animation is precisely the outside thing the rule allows for
import { useEffect, useRef } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ProgressBar, useReducedMotion } from '../../../components/ui';
import { space, Text } from '../../../theme';
import { slotProgress } from '../chair';
import type { Appointment } from '../data';
import { useNowSeconds } from '../useNow';

const ROLL = 7;
const ROLL_MS = 260;

export type ChairProgressProps = {
    appointment: Appointment;
    seatedAt?: string;
    onDark?: boolean;
    style?: StyleProp<ViewStyle>;
};

export function ChairProgress({ appointment, seatedAt, onDark = true, style }: ChairProgressProps) {
    const nowMinutes = useNowSeconds();
    const progress = slotProgress(appointment, nowMinutes, seatedAt);

    return (
        <View style={[styles.progress, style]}>
            <View style={styles.track}>
                <ProgressBar
                    value={progress.value}
                    tone={progress.over ? 'due' : onDark ? 'live' : 'success'}
                    height={5}
                    onDark={onDark}
                    accessibilityLabel="Time into the slot"
                />
            </View>

            <View
                style={styles.readout}
                accessible
                accessibilityRole="text"
                accessibilityLabel={progress.label}
            >
                <TickingCount count={progress.count} />
                <Text variant="footnote" script="mono" weight="medium" tone="muted">
                    {progress.of}
                </Text>
            </View>
        </View>
    );
}

function TickingCount({ count }: { count: string }) {
    const characters = [...count];

    return (
        <View style={styles.digits}>
            {characters.map((character, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the column *is* the identity — an odometer wheel is defined by where it sits, and counting from the right is what keeps a wheel on its own digit when the count gains one
                <Digit key={characters.length - 1 - index} character={character} />
            ))}
        </View>
    );
}

function Digit({ character }: { character: string }) {
    const reducedMotion = useReducedMotion();
    const roll = useSharedValue(0);
    const shown = useRef<string | null>(null);

    useEffect(() => {
        const turned = shown.current !== character;
        shown.current = character;

        if (reducedMotion || !turned) {
            roll.value = 0;
            return;
        }
        roll.value = 1;
        roll.value = withTiming(0, { duration: ROLL_MS, easing: Easing.out(Easing.cubic) });
    }, [character, reducedMotion, roll]);

    const rolling = useAnimatedStyle(() => ({
        transform: [{ translateY: roll.value * ROLL }],
        opacity: 1 - roll.value * 0.85,
    }));

    return (
        <View style={styles.digit}>
            <Animated.View style={rolling}>
                <Text variant="footnote" script="mono" weight="medium" tone="muted">
                    {character}
                </Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    progress: { flexDirection: 'row', alignItems: 'center', gap: space[2.5], marginTop: space[4] },
    track: { flex: 1 },
    readout: { flexDirection: 'row', alignItems: 'center', gap: space[1], direction: 'ltr' },
    digits: { flexDirection: 'row', alignItems: 'center' },
    digit: { overflow: 'hidden' },
});
