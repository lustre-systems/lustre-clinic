import type { ReactNode } from 'react';
// biome-ignore lint/style/noRestrictedImports: restarts the entrance `Animated.timing` when the step changes and reads the previous step to pick a side
import { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useIsRTL } from '../../i18n';
import { duration, easing } from './motion';
import { stepDirection, stepOffset } from './stepTransition';
import { useReducedMotion } from './useReducedMotion';

export type StepViewProps = {
    index: number;
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    testID?: string;
};

export function StepView({ index, children, style, testID }: StepViewProps) {
    const isRTL = useIsRTL();
    const reducedMotion = useReducedMotion();
    const progress = useRef(new Animated.Value(1)).current;
    const shown = useRef(index);
    const from = useRef(0);

    if (shown.current !== index) {
        from.current = stepOffset(stepDirection(shown.current, index), isRTL);
        shown.current = index;
        progress.setValue(reducedMotion ? 1 : 0);
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the signal, not a value read — a new step is what restarts the entrance
    useEffect(() => {
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: reducedMotion ? 0 : duration.step,
            easing: easing.sheet,
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [index, progress, reducedMotion]);

    return (
        <Animated.View
            style={[
                style,
                {
                    opacity: progress,
                    transform: [
                        {
                            translateX: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [from.current, 0],
                            }),
                        },
                    ],
                },
            ]}
            testID={testID}
        >
            {children}
        </Animated.View>
    );
}
