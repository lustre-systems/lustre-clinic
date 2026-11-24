// biome-ignore lint/style/noRestrictedImports: runs the staggered entry `Animated.timing` on mount and stops it on cleanup
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { duration, easing } from './motion';
import { useReducedMotion } from './useReducedMotion';

const MAX_STAGGER_STEPS = 8;
const STAGGER_MS = 32;

export type FadeUpProps = {
    index?: number;
    animate?: boolean;
    children: ReactNode;
};

export function FadeUp({ index = 0, animate = true, children }: FadeUpProps) {
    const reducedMotion = useReducedMotion();
    const play = useRef(animate).current;
    const entry = useRef(new Animated.Value(play ? 0 : 1)).current;

    useEffect(() => {
        if (!play) return;
        const animation = Animated.timing(entry, {
            toValue: 1,
            duration: reducedMotion ? 0 : duration.fadeup,
            delay: reducedMotion ? 0 : Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS,
            easing: easing.standard,
            useNativeDriver: true,
        });

        animation.start();
        return () => animation.stop();
    }, [entry, play, reducedMotion, index]);

    return (
        <Animated.View
            style={{
                opacity: entry,
                transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
            }}
        >
            {children}
        </Animated.View>
    );
}
