/**
 * The header from `day-view-schedule.html`: a branch pill and a date pill. It
 * replaces a centred `Today` between two arrows — the date pill
 * is the only way off today and opens the calendar, carrying the weekday
 * whenever the screen is not on today, so the fact the arrows made obvious is
 * still written down. The branch menu anchors to the pill's start edge via
 * physical left; in RTL the window width less the pill's far edge is the same
 * distance measured the other way.
 *
 * The name scrolls over when `branchId` changes under it, because it is not
 * always the user who changed it: picking a day in the calendar moves the day
 * view to the branch that day is busiest in, and a branch name that quietly
 * rewrites itself in the corner is how someone reads the wrong branch's day.
 * The outgoing name is held in state for the length of the slide and drawn
 * over the incoming one, so what reads is one name pushing the other out
 * rather than a word swapping. It travels the way the branch list runs — a
 * branch further down enters from the end edge — and `I18nManager` flips that
 * with the writing direction, since the list reads the other way in Arabic.
 * The clip is what makes it a slide instead of a name wandering across the
 * header, and the accent wash under it says the change came from elsewhere.
 * Only a change animates, never the first branch to arrive; reduced motion
 * runs it at duration 0, so the name lands without travelling.
 */
// biome-ignore lint/style/noRestrictedImports: runs the branch-change slide `Animated.timing` and clears the outgoing name on its completion callback
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, View } from 'react-native';
import {
    Chevron,
    DropdownMenu,
    duration,
    easing,
    type MenuAnchor,
    useReducedMotion,
} from '../../../components/ui';
import { useIsRTL, useT } from '../../../i18n';
import { border, color, radius, shadow, size, space, Text } from '../../../theme';
import type { Branch } from '../data';
import { formatDate, formatDatePill, relativeDayLabel } from '../time';
import { CalendarIcon, PinIcon } from './icons';

/** How far a name travels on its way in, and the one leaving on its way out. */
const SLIDE = space[7];

export type DayHeaderProps = {
    dateKey: string;
    branches: readonly Branch[];
    branchId: string | null;
    onPickBranch: (branchId: string) => void;
    onOpenCalendar: () => void;
};

export function DayHeader({ dateKey, branches, branchId, onPickBranch, onOpenCalendar }: DayHeaderProps) {
    const t = useT();
    const isRTL = useIsRTL();
    const [menu, setMenu] = useState(false);
    const [anchor, setAnchor] = useState<MenuAnchor | undefined>(undefined);
    const pill = useRef<View>(null);

    const branch = branches.find((row) => row.id === branchId) ?? branches[0];
    const switchable = branches.length > 1;

    const slide = useRef(new Animated.Value(1)).current;
    const shown = useRef<Branch | undefined>(undefined);
    const [leaving, setLeaving] = useState<{ name: string; toward: number } | null>(null);
    const reducedMotion = useReducedMotion();

    const shownId = branch?.id;

    // biome-ignore lint/correctness/useExhaustiveDependencies: the branch id is the change
    useEffect(() => {
        const previous = shown.current;
        shown.current = branch;
        if (!previous || !branch || previous.id === branch.id) return;

        const order = branches.findIndex((row) => row.id === branch.id);
        const cameFrom = branches.findIndex((row) => row.id === previous.id);
        const forward = order > cameFrom ? 1 : -1;

        setLeaving({ name: previous.name, toward: isRTL ? -forward : forward });
        slide.setValue(0);
        Animated.timing(slide, {
            toValue: 1,
            duration: reducedMotion ? 0 : duration.push,
            easing: easing.promote,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) setLeaving(null);
        });
    }, [shownId, slide, reducedMotion, isRTL]);

    const toward = leaving?.toward ?? 1;
    const entering = {
        opacity: slide.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0.2, 1] }),
        transform: [
            { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [toward * SLIDE, 0] }) },
        ],
    };
    const departing = {
        opacity: slide.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.1, 0] }),
        transform: [
            { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -toward * SLIDE] }) },
        ],
    };
    const wash = slide.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.9, 0.7, 0] });

    function openBranches() {
        pill.current?.measureInWindow((x, y, width, height) => {
            setAnchor({
                top: y + height + space[1],
                start: isRTL ? Dimensions.get('window').width - (x + width) : x,
            });
            setMenu(true);
        });
    }

    return (
        <View style={styles.header}>
            <View style={styles.row}>
                <View ref={pill} collapsable={false}>
                    <Pressable
                        accessibilityRole={switchable ? 'button' : 'text'}
                        accessibilityLabel={
                            switchable
                                ? t('Branch: {branch}. Change branch', { branch: branch?.name ?? t('none') })
                                : branch?.name
                        }
                        disabled={!switchable}
                        onPress={openBranches}
                        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                    >
                        {leaving ? (
                            <Animated.View pointerEvents="none" style={[styles.wash, { opacity: wash }]} />
                        ) : null}
                        <PinIcon stroke={color.ink} />
                        <View style={styles.branchClip}>
                            <Animated.View style={entering}>
                                <Text variant="callout" weight="semibold" numberOfLines={1}>
                                    {branch?.name ?? t('Clinic')}
                                </Text>
                            </Animated.View>
                            {leaving ? (
                                <Animated.View pointerEvents="none" style={[styles.branchLeaving, departing]}>
                                    <Text variant="callout" weight="semibold" numberOfLines={1}>
                                        {leaving.name}
                                    </Text>
                                </Animated.View>
                            ) : null}
                        </View>
                        {switchable ? <Chevron direction="down" size={7} /> : null}
                    </Pressable>
                </View>

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('{relative}, {date}. Open the calendar', {
                        relative: relativeDayLabel(dateKey),
                        date: formatDate(dateKey),
                    })}
                    onPress={onOpenCalendar}
                    style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                    testID="day-date-pill"
                >
                    <CalendarIcon />
                    <Text variant="footnote" script="mono" weight="medium" tone="ink2">
                        {formatDatePill(dateKey)}
                    </Text>
                    <Chevron direction="down" size={7} />
                </Pressable>
            </View>

            <DropdownMenu
                visible={menu}
                onClose={() => setMenu(false)}
                anchor={anchor}
                accessibilityLabel="Branches"
                options={branches.map((row) => ({ value: row.id, label: row.name }))}
                value={branch?.id ?? ''}
                onChange={onPickBranch}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: size.gutter,
        paddingTop: space[2],
        paddingBottom: space[3],
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        paddingVertical: space[1.5],
        paddingHorizontal: space[3],
        minHeight: space[8],
        backgroundColor: color.surface,
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
    },
    pressed: { backgroundColor: color.surface2 },
    wash: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        backgroundColor: color.accentSoft,
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.accent,
    },
    branchClip: { maxWidth: 120, overflow: 'hidden' },
    branchLeaving: { position: 'absolute', top: 0, start: 0 },
});
