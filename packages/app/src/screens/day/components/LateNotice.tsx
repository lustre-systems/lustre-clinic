import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { duration, easing, useReducedMotion } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { ClockIcon, CloseIcon } from './icons';

export type LateNoticeProps = {
    late: string;
    gap: number;
    onDismissed: () => void;
};

export function LateNotice({ late, gap, onDismissed }: LateNoticeProps) {
    const t = useT();
    const reducedMotion = useReducedMotion();
    const shown = useRef(new Animated.Value(1)).current;
    const [height, setHeight] = useState<number | null>(null);
    const [leaving, setLeaving] = useState(false);

    function dismiss() {
        if (leaving) return;
        setLeaving(true);
        if (reducedMotion || height === null) {
            onDismissed();
            return;
        }
        Animated.timing(shown, {
            toValue: 0,
            duration: duration.collapse,
            easing: easing.sheet,
            useNativeDriver: false,
        }).start(({ finished }) => {
            if (finished) onDismissed();
        });
    }

    return (
        <Animated.View
            pointerEvents={leaving ? 'none' : 'auto'}
            style={
                leaving && height !== null
                    ? {
                          overflow: 'hidden',
                          height: shown.interpolate({
                              inputRange: [0, 0.7],
                              outputRange: [0, height],
                              extrapolate: 'clamp',
                          }),
                          marginBottom: shown.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
                          opacity: shown.interpolate({
                              inputRange: [0.4, 1],
                              outputRange: [0, 1],
                              extrapolate: 'clamp',
                          }),
                          transform: [
                              {
                                  translateY: shown.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [-space[2], 0],
                                  }),
                              },
                          ],
                      }
                    : undefined
            }
            onLayout={leaving ? undefined : (event) => setHeight(event.nativeEvent.layout.height)}
            testID="day-late-notice"
        >
            <View style={styles.late}>
                <ClockIcon size={13} stroke={color.due} />
                <Text
                    variant="footnote"
                    weight="bold"
                    tone="due"
                    style={styles.text}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="assertive"
                >
                    {t('Running {late}', { late })}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss"
                    hitSlop={space[3]}
                    onPress={dismiss}
                    testID="day-late-dismiss"
                >
                    <CloseIcon size={14} stroke={color.due} />
                </Pressable>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    text: { flex: 1 },
    late: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        marginHorizontal: size.gutter,
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.dueSoft,
        backgroundColor: color.dueSoft,
    },
});
