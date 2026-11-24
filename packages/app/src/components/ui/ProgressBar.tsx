// biome-ignore lint/style/noRestrictedImports: an `Animated.timing` driven imperatively — the fill chases a prop and the tween has to be stopped on cleanup
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius } from '../../theme';
import { easing, duration as motionDuration } from './motion';
import { useReducedMotion } from './useReducedMotion';

export type ProgressTone = 'accent' | 'success' | 'due' | 'live' | 'ink';

export type ProgressBarProps = {
    value: number;
    tone?: ProgressTone;
    height?: number;
    onDark?: boolean;
    accessibilityLabel?: string;
};

const TONE: Record<ProgressTone, string> = {
    accent: color.accent,
    success: color.success,
    due: color.due,
    live: color.live,
    ink: color.ink,
};

export function ProgressBar({
    value,
    tone = 'accent',
    height = 3,
    onDark = false,
    accessibilityLabel,
}: ProgressBarProps) {
    const t = useT();
    const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    const reducedMotion = useReducedMotion();
    const filled = useRef(new Animated.Value(clamped)).current;

    useEffect(() => {
        if (reducedMotion) {
            filled.setValue(clamped);
            return;
        }
        const tween = Animated.timing(filled, {
            toValue: clamped,
            duration: motionDuration.fadeup,
            easing: easing.standard,
            useNativeDriver: false,
        });
        tween.start();
        return () => tween.stop();
    }, [clamped, reducedMotion, filled]);

    const width = filled.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
            style={[
                styles.track,
                { height, borderRadius: height },
                onDark ? styles.trackDark : styles.trackLight,
            ]}
        >
            <Animated.View
                style={[styles.fill, { width, backgroundColor: TONE[tone], borderRadius: height }]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    track: { alignSelf: 'stretch', overflow: 'hidden', borderRadius: radius.full },
    trackLight: { backgroundColor: color.outline },
    trackDark: { backgroundColor: color.ink2 },
    fill: { height: '100%' },
});
