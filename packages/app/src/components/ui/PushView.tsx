import type { ReactNode } from 'react';
// biome-ignore lint/style/noRestrictedImports: runs the slide `Animated.timing` and unmounts on its completion callback — the exit has to finish before the pane leaves the tree
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';
import { useIsRTL } from '../../i18n';
import { color } from '../../theme';
import { duration, easing } from './motion';
import { useReducedMotion } from './useReducedMotion';

export type PushViewProps = {
    visible: boolean;
    children: ReactNode;
    onClosed?: () => void;
    testID?: string;
};

export function PushView({ visible, children, onClosed, testID }: PushViewProps) {
    const isRTL = useIsRTL();
    const progress = useRef(new Animated.Value(0)).current;
    const [mounted, setMounted] = useState(visible);
    const reducedMotion = useReducedMotion();
    const window = useWindowDimensions();

    const closed = useRef(onClosed);
    closed.current = onClosed;

    useEffect(() => {
        if (visible) setMounted(true);
        const animation = Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: reducedMotion ? 0 : duration.push,
            easing: easing.sheet,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (!finished || visible) return;
            setMounted(false);
            closed.current?.();
        });
        return () => animation.stop();
    }, [visible, progress, reducedMotion]);

    if (!mounted) return null;

    const offscreen = isRTL ? -window.width : window.width;

    return (
        <Animated.View
            style={[
                styles.pane,
                {
                    transform: [
                        {
                            translateX: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [offscreen, 0],
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

const styles = StyleSheet.create({
    pane: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: color.canvas },
});
