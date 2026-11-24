// biome-ignore lint/style/noRestrictedImports: starts the expand animation, which runs on the UI thread, when the day is opened or a save lands
import { useEffect, useState, useSyncExternalStore } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { GLYPH, icon } from '../components/domain';
import { useReducedMotion } from '../components/ui';
import { useLocale, useT } from '../i18n';
import { border, color, radius, shadow, space, Text } from '../theme';
import { buttonLabel, TITLE } from './format';
import { hasUnseen, lastDone } from './store';

const HistoryIcon = icon(GLYPH.lastDone, { width: 2.2 });

const SLOT = space[8];
const HOLD_MS = 3000;
const TURNS = 2;
const OPEN_MS = 700;
const CLOSE_MS = 600;
const PROMOTE = Easing.bezier(0.22, 0.9, 0.3, 1);
const SETTLE = Easing.out(Easing.quad);
const SETTLE_MS = 300;
const TUCK = space[1];
const LEAD = space[2.5];

export type LastDoneButtonProps = {
    active: boolean;
    onPress: () => void;
};

export function LastDoneButton({ active, onPress }: LastDoneButtonProps) {
    const t = useT();
    const locale = useLocale();
    const reduced = useReducedMotion();
    const state = useSyncExternalStore(lastDone.subscribe, lastDone.getSnapshot);
    const [labelWidth, setLabelWidth] = useState(0);
    const [room, setRoom] = useState(0);

    const open = useSharedValue(0);
    const turn = useSharedValue(0);

    const newest = state.entries[0];
    const said = newest ? buttonLabel(newest, locale) : { said: t('Last done'), name: null };
    const full = newest ? [t(TITLE[newest.kind]), newest.patientName].filter(Boolean).join(' · ') : null;
    const maxLabel = Math.max(0, room - SLOT - LEAD + TUCK);

    const ready = active && state.hydrated && labelWidth > 0;
    const unseen = hasUnseen(state);

    function rest() {
        cancelAnimation(open);
        cancelAnimation(turn);
        open.value = 0;
        turn.value = 0;
    }

    function play(wait = 0) {
        rest();
        if (reduced || labelWidth === 0) return;
        open.value = withDelay(
            wait,
            withSequence(
                withTiming(1, { duration: OPEN_MS, easing: PROMOTE }),
                withDelay(HOLD_MS, withTiming(0, { duration: CLOSE_MS, easing: SETTLE })),
            ),
        );
        turn.value = withDelay(
            wait,
            withSequence(
                withTiming(-360 * TURNS, { duration: OPEN_MS, easing: PROMOTE }),
                withDelay(HOLD_MS, withTiming(0, { duration: CLOSE_MS, easing: SETTLE })),
            ),
        );
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: plays on opening the day and on each new line — not on every render that reads the log
    useEffect(() => {
        if (!ready) {
            rest();
            return;
        }
        if (unseen) play(SETTLE_MS);
    }, [ready, newest?.id]);

    const pill = useAnimatedStyle(() => ({
        width: interpolate(open.value, [0, 1], [SLOT, SLOT + LEAD + labelWidth]),
    }));
    const label = useAnimatedStyle(() => ({ opacity: interpolate(open.value, [0.35, 1], [0, 1], 'clamp') }));
    const glyph = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

    function measure(event: LayoutChangeEvent) {
        const width = Math.ceil(event.nativeEvent.layout.width);
        if (width !== labelWidth) setLabelWidth(width);
    }

    return (
        <View style={styles.room} onLayout={(event) => setRoom(Math.floor(event.nativeEvent.layout.width))}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={full ? `${t('Last done')}: ${full}` : t('Last done')}
                onPress={() => {
                    play();
                    onPress();
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.slot, pressed && styles.pressed]}
                testID="last-done"
            >
                <Animated.View style={[styles.pill, pill]}>
                    <View style={[styles.track, { width: maxLabel + SLOT + LEAD }]}>
                        <Animated.View style={[styles.glyph, glyph]}>
                            <HistoryIcon size={16} stroke={color.ink} />
                        </Animated.View>
                        <Animated.View
                            style={[styles.words, label, { maxWidth: maxLabel }]}
                            onLayout={measure}
                        >
                            <Text variant="footnote" weight="semibold" numberOfLines={1}>
                                {said.said}
                                {said.name ? (
                                    <Text variant="footnote" weight="regular">
                                        {` ${said.name}`}
                                    </Text>
                                ) : null}
                            </Text>
                        </Animated.View>
                    </View>
                </Animated.View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    room: { alignSelf: 'stretch', alignItems: 'flex-end' },
    slot: { height: SLOT },
    pressed: { opacity: 0.72 },
    pill: {
        height: SLOT,
        borderRadius: radius.full,
        backgroundColor: color.surface,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
        overflow: 'hidden',
    },
    track: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    glyph: { width: SLOT - border.hair * 2, alignItems: 'center', justifyContent: 'center' },
    words: { marginStart: -TUCK },
});
