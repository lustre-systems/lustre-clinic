// biome-ignore lint/style/noRestrictedImports: drives the chair dot's `Animated.loop` imperatively, and stops it on cleanup
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { PULSE, useReducedMotion } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, space, Text } from '../../../theme';
import type { Standing } from '../chair';

export type VisitState = Standing | 'arriving' | 'unpaid';

const LABEL: Record<VisitState, string> = {
    arriving: 'Not checked in yet',
    waiting: 'Waiting to be seen',
    chair: 'Visit in progress',
    desk: 'At the desk',
    finished: 'Completed visit',
    unpaid: 'Waiting to be paid',
};

export function visitState(standing: Standing | 'arriving', closed: boolean): VisitState {
    if (standing !== 'finished') return standing;
    return closed ? 'finished' : 'unpaid';
}

export function VisitStatusChip({ state }: { state: VisitState }) {
    const t = useT();
    const settled = state === 'finished';

    return (
        <View style={[styles.chip, settled && styles.chipSettled]}>
            <Dot settled={settled} pulse={state === 'chair'} />
            <Text variant="caption" weight="bold" tone={settled ? 'successText' : 'ink2'}>
                {t(LABEL[state])}
            </Text>
        </View>
    );
}

function Dot({ settled, pulse }: { settled: boolean; pulse: boolean }) {
    const opacity = useRef(new Animated.Value(1)).current;
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        if (reducedMotion || !pulse) return;

        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: PULSE.min,
                    duration: PULSE.duration,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, { toValue: 1, duration: PULSE.duration, useNativeDriver: true }),
            ]),
        );

        loop.start();
        return () => loop.stop();
    }, [opacity, reducedMotion, pulse]);

    return <Animated.View style={[styles.dot, settled && styles.dotSettled, { opacity }]} />;
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        paddingStart: space[2],
        paddingEnd: space[2.5],
        paddingVertical: space[1],
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },
    chipSettled: { backgroundColor: color.successSoft },
    dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: color.ink2 },
    dotSettled: { backgroundColor: color.successText },
});
