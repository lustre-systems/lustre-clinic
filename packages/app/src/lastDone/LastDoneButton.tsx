/**
 * The history button on a heading row: a small round icon that opens the
 * "Last done" sheet.
 *
 * When the tab it sits on is opened and something has been done since the
 * sheet was last looked at, it widens to show its label — "Last done ↺", the
 * icon on the far side from the words — spinning the icon backwards as it goes,
 * holds for two seconds and folds back, spinning forward again. Nothing new, no movement: after
 * fifty tab switches a day it would otherwise be noise. Reduced motion skips it
 * altogether.
 *
 * The round slot is all it takes in the row. The label grows over the heading
 * beside it rather than pushing it, so nothing else on the row moves, and on a
 * narrow phone the title and both buttons still fit.
 */
// biome-ignore lint/style/noRestrictedImports: starts the expand animation, which runs on the UI thread, when the tab it sits on is opened
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
import { useT } from '../i18n';
import { border, color, radius, shadow, space, Text } from '../theme';
import { hasUnseen, lastDone } from './store';

const HistoryIcon = icon(GLYPH.lastDone, { width: 2.2 });

const SLOT = 36;
const HOLD_MS = 2000;
// Two full turns each way: back as it opens, forward again as it closes, so it
// winds back to where it started. Longer than `ui/motion`'s promote and
// collapse, which spin a turn and a half too fast to read.
const TURNS = 2;
const OPEN_MS = 700;
const CLOSE_MS = 600;
// `ui/motion`'s promote and standard curves, as worklets: the UI thread cannot
// run React Native's own `Easing`.
const PROMOTE = Easing.bezier(0.22, 0.9, 0.3, 1);
const SETTLE = Easing.out(Easing.quad);
/** The label's lead-in from the pill's open edge. */
const LEAD = space[3.5];

export type LastDoneButtonProps = {
    /** The tab this sits on is on screen. Turning true is what "opening the tab" means. */
    active: boolean;
    onPress: () => void;
};

export function LastDoneButton({ active, onPress }: LastDoneButtonProps) {
    const t = useT();
    const reduced = useReducedMotion();
    const state = useSyncExternalStore(lastDone.subscribe, lastDone.getSnapshot);
    const [labelWidth, setLabelWidth] = useState(0);

    const open = useSharedValue(0);
    const turn = useSharedValue(0);

    const ready = active && state.hydrated && labelWidth > 0;
    const unseen = hasUnseen(state);

    // biome-ignore lint/correctness/useExhaustiveDependencies: only opening the tab plays it — a write made while it is up waits for the next opening
    useEffect(() => {
        cancelAnimation(open);
        cancelAnimation(turn);
        open.value = 0;
        turn.value = 0;
        if (!ready || !unseen || reduced) return;

        open.value = withSequence(
            withTiming(1, { duration: OPEN_MS, easing: PROMOTE }),
            withDelay(HOLD_MS, withTiming(0, { duration: CLOSE_MS, easing: SETTLE })),
        );
        turn.value = withSequence(
            withTiming(-360 * TURNS, { duration: OPEN_MS, easing: PROMOTE }),
            withDelay(HOLD_MS, withTiming(0, { duration: CLOSE_MS, easing: SETTLE })),
        );
    }, [ready]);

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
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Last done')}
            onPress={onPress}
            hitSlop={8}
            style={({ pressed }) => [styles.slot, pressed && styles.pressed]}
            testID="last-done"
        >
            <Animated.View style={[styles.pill, pill]}>
                <View style={styles.track}>
                    <Animated.View style={label} onLayout={measure}>
                        <Text variant="subhead" weight="semibold" numberOfLines={1}>
                            {t('Last done')}
                        </Text>
                    </Animated.View>
                    <Animated.View style={[styles.glyph, glyph]}>
                        <HistoryIcon size={17} stroke={color.ink} />
                    </Animated.View>
                </View>
            </Animated.View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    slot: { width: SLOT, height: SLOT },
    pressed: { opacity: 0.72 },
    // Anchored to the end of the slot and grown towards the start, over the
    // heading: `end` and the row both flip in Arabic, so it mirrors as a whole.
    pill: {
        position: 'absolute',
        top: 0,
        end: 0,
        height: SLOT,
        borderRadius: radius.full,
        backgroundColor: color.surface,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
        overflow: 'hidden',
    },
    // Wider than the pill will ever be and pinned to its end, so the words are
    // laid out at their own width — which is what `measure` reads — and the
    // pill only uncovers them.
    track: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        end: 0,
        width: 320,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    glyph: { width: SLOT - border.hair * 2, alignItems: 'center', justifyContent: 'center' },
});
