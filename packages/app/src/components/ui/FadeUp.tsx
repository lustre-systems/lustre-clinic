/**
 * A list row arriving: it fades up 4px into place, a beat after the row above
 * it, so a list that loads reads top to bottom rather than appearing at once.
 * The stagger stops growing after a screenful, so a long list does not keep
 * its last rows waiting.
 *
 * It plays once, on mount. `animate={false}` mounts the row already in place —
 * for a row the list has shown before and is only redrawing, such as one a
 * virtualized list unmounted while it was scrolled away.
 */
// biome-ignore lint/style/noRestrictedImports: runs the staggered entry `Animated.timing` on mount and stops it on cleanup
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { duration, easing } from './motion';
import { useReducedMotion } from './useReducedMotion';

const MAX_STAGGER_STEPS = 8;
const STAGGER_MS = 32;

export type FadeUpProps = {
    /** Its place in the list, which sets how long it waits. */
    index?: number;
    animate?: boolean;
    children: ReactNode;
};

export function FadeUp({ index = 0, animate = true, children }: FadeUpProps) {
    const reducedMotion = useReducedMotion();
    // Read once: the row decides on mount whether it arrives, and a later
    // render saying it has been seen must not cut the entry short.
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
