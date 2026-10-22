/**
 * The CSS chevron: two borders on one box, rotated. `borderEndWidth` already
 * flips in Arabic, so the rotation has to flip with it — `forward` and `back`
 * mirror in Arabic; up and down do not.
 *
 * Between up and down it turns rather than snapping, so a dropdown's chevron
 * flips over as its menu opens and back as it closes.
 */
// biome-ignore lint/style/noRestrictedImports: runs the flip's `Animated.timing` when the direction changes between up and down
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useIsRTL } from '../../i18n';
import { color } from '../../theme';
import { duration, easing } from './motion';
import { useReducedMotion } from './useReducedMotion';

export type ChevronDirection = 'forward' | 'back' | 'up' | 'down';

export type ChevronProps = {
    direction?: ChevronDirection;
    size?: number;
    tone?: 'muted' | 'ink' | 'inverse' | 'accent';
};

const TONE = {
    muted: color.muted,
    ink: color.ink,
    inverse: color.inverse,
    accent: color.accent,
} as const;

const ROTATION: Record<ChevronDirection, [ltr: string, rtl: string]> = {
    forward: ['45deg', '-45deg'],
    back: ['-135deg', '135deg'],
    up: ['-45deg', '45deg'],
    down: ['135deg', '-135deg'],
};

export function Chevron({ direction = 'forward', size = 8, tone = 'muted' }: ChevronProps) {
    const [ltr, rtl] = ROTATION[direction];
    const isRTL = useIsRTL();
    const reducedMotion = useReducedMotion();
    const vertical = direction === 'up' || direction === 'down';
    const flip = useRef(new Animated.Value(direction === 'up' ? 1 : 0)).current;

    useEffect(() => {
        if (!vertical) return;
        const animation = Animated.timing(flip, {
            toValue: direction === 'up' ? 1 : 0,
            duration: reducedMotion ? 0 : duration.drop,
            easing: easing.standard,
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [flip, direction, vertical, reducedMotion]);

    // Down to up is half a turn: 135° → -45°, mirrored in Arabic.
    const down = ROTATION.down[isRTL ? 1 : 0];
    const up = ROTATION.up[isRTL ? 1 : 0];
    const rotate = vertical
        ? flip.interpolate({ inputRange: [0, 1], outputRange: [down, up] })
        : isRTL
          ? rtl
          : ltr;

    return (
        <Animated.View
            style={[
                styles.chevron,
                {
                    width: size,
                    height: size,
                    borderColor: TONE[tone],
                    transform: [{ rotate }],
                },
            ]}
        />
    );
}

const styles = StyleSheet.create({
    chevron: { borderTopWidth: 1.5, borderEndWidth: 1.5 },
});
