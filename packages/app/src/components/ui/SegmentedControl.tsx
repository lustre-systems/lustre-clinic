// biome-ignore lint/style/noRestrictedImports: slides the thumb with `Animated.timing` when the selection moves, and stops it on cleanup
import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useIsRTL, useT } from '../../i18n';
import { border, color, radius, shadow, space, Text } from '../../theme';
import { duration, easing } from './motion';
import { useReducedMotion } from './useReducedMotion';

export type Segment<T extends string> = {
    value: T;
    label: string;
    icon?: (selected: boolean) => React.ReactNode;
};

export type SegmentedControlSize = 'md' | 'sm';

export type SegmentedControlProps<T extends string> = {
    segments: readonly Segment<T>[];
    value: T;
    onChange: (value: T) => void;
    size?: SegmentedControlSize;
    accessibilityLabel?: string;
    testID?: string;
};

export function SegmentedControl<T extends string>({
    segments,
    value,
    onChange,
    size = 'md',
    accessibilityLabel,
    testID,
}: SegmentedControlProps<T>) {
    const index = Math.max(
        0,
        segments.findIndex((segment) => segment.value === value),
    );
    const [slot, setSlot] = useState<{ x: number; width: number } | null>(null);
    const slide = useRef(new Animated.Value(0)).current;
    const placed = useRef(false);
    const reducedMotion = useReducedMotion();
    const isRTL = useIsRTL();
    const t = useT();

    const inset = slot ? (isRTL ? slot.x - (segments.length - 1) * slot.width : slot.x) : 0;
    const step = slot ? (isRTL ? -1 : 1) * (inset + index * slot.width) : 0;

    // biome-ignore lint/correctness/useExhaustiveDependencies: the step is the change
    useEffect(() => {
        if (!slot) return;

        if (!placed.current) {
            placed.current = true;
            slide.setValue(step);
            return;
        }

        const animation = Animated.timing(slide, {
            toValue: step,
            duration: reducedMotion ? 0 : duration.fade,
            easing: easing.promote,
            useNativeDriver: true,
        });
        animation.start();

        return () => animation.stop();
    }, [step, slide, reducedMotion]);

    function onFirstSegmentLayout(event: LayoutChangeEvent) {
        const { x, width } = event.nativeEvent.layout;
        if (slot && slot.x === x && slot.width === width) return;
        setSlot({ x, width });
    }

    return (
        <View
            accessibilityRole="tablist"
            accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
            style={styles.track}
            testID={testID}
        >
            {slot ? (
                <Animated.View
                    pointerEvents="none"
                    style={[styles.thumb, { width: slot.width, transform: [{ translateX: slide }] }]}
                />
            ) : null}

            {segments.map((segment, at) => {
                const selected = segment.value === value;
                return (
                    <Pressable
                        key={segment.value}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        onLayout={at === 0 ? onFirstSegmentLayout : undefined}
                        onPress={() => onChange(segment.value)}
                        style={[styles.segment, size === 'sm' && styles.segmentSm]}
                    >
                        {segment.icon?.(selected)}
                        <Text
                            variant={size === 'sm' ? 'subhead' : 'callout'}
                            weight={selected ? 'semibold' : 'medium'}
                            tone={selected ? 'ink' : 'ink2'}
                        >
                            {t(segment.label)}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    track: {
        flexDirection: 'row',
        alignSelf: 'stretch',
        padding: 3,
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface2,
    },
    segment: {
        flex: 1,
        flexDirection: 'row',
        gap: space[1.5],
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 38,
        paddingHorizontal: space[3],
        borderRadius: radius.full,
    },
    segmentSm: { minHeight: 30 },
    thumb: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        borderRadius: radius.full,
        backgroundColor: color.surface,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
    },
});
