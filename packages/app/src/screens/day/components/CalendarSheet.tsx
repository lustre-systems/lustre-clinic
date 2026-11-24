import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { Button, Chevron, duration, IconButton, Sheet, useReducedMotion } from '../../../components/ui';
import { useIsRTL, useT } from '../../../i18n';
import { border, color, radius, shadow, size, space, Text } from '../../../theme';
import { api, type Branch, type ClinicDay, useLocalQuery } from '../data';
import { describeError } from '../errors';
import { isClosed } from '../hours';
import { type DayLoad, loadsFrom } from '../month';
import {
    addMonths,
    dayOfMonth,
    formatDate,
    formatMonth,
    keyParts,
    monthDays,
    time12,
    todayKey,
} from '../time';
import { WeekdayHeader, WeekRows } from './WeekRows';

export type CalendarSheetProps = {
    visible: boolean;
    selected: string;
    schedule: readonly ClinicDay[] | undefined;
    branches: readonly Branch[];
    branchId: string | null;
    mode?: 'open' | 'book';
    onPick: (dateKey: string, branchId: string | null) => void;
    onClose: () => void;
};

const FULL_AT = 0.9;
const PENDING_LOAD_WIDTH = 8;
const SWIPE_DISTANCE = 48;
const SWIPE_VELOCITY = 600;
const SLIDE = { duration: duration.push, dampingRatio: 1, overshootClamping: true } as const;
const NO_LOADS: ReadonlyMap<string, DayLoad> = new Map();

type Leaving = {
    origin: string;
    month: string;
    loads: ReadonlyMap<string, DayLoad>;
    counting: boolean;
    pending: string;
};

type Paging = { month: string; pending: string; leaving: Leaving | null };

function monthIndex(key: string): number {
    const date = keyParts(key);
    return date.year * 12 + date.month - 1;
}

function slideTo(target: number, velocity: number, reduced: boolean, settle: () => void) {
    'worklet';
    const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(settle);
    };
    return reduced
        ? withTiming(target, { duration: 0 }, done)
        : withSpring(target, { ...SLIDE, velocity }, done);
}

let lastScope: string | null = null;

export function CalendarSheet({
    visible,
    selected,
    schedule,
    branches,
    branchId,
    mode = 'open',
    onPick,
    onClose,
}: CalendarSheetProps) {
    const t = useT();
    const isRTL = useIsRTL();
    const [{ month, pending, leaving }, setPaging] = useState<Paging>({
        month: selected,
        pending: selected,
        leaving: null,
    });
    const [scope, setScope] = useState(lastScope);
    const [viewport, setViewport] = useState(0);
    const reducedMotion = useReducedMotion();

    const days = monthDays(month);
    const query = useLocalQuery(`month:${month}`, () => api.byDates(days).then((rows) => ({ month, rows })), {
        enabled: visible,
    });
    const fetched = query.data?.month === month ? query.data.rows : undefined;

    const scoped =
        fetched && scope ? fetched.map((rows) => rows.filter((row) => row.branchId === scope)) : fetched;

    const loads = scoped ? loadsFrom(days, scoped, schedule, branchId) : new Map<string, DayLoad>();
    const today = todayKey();

    const counting = query.status === 'loading' || (query.status === 'success' && !fetched);

    const [base] = useState(() => monthIndex(selected));
    const page = monthIndex(month) - base;
    const position = useSharedValue(page);
    const aim = useSharedValue(page);
    const width = useSharedValue(0);
    const start = useSharedValue(0);
    const forward = isRTL ? -1 : 1;
    const strip = useAnimatedStyle(() => ({
        transform: [{ translateX: -position.value * width.value * forward }],
    }));

    const origin = leaving ? monthIndex(leaving.origin) - base : page;
    const first = viewport > 0 ? Math.min(page - 1, origin) : page;
    const last = viewport > 0 ? Math.max(page + 1, origin) : page;
    const pages = Array.from({ length: last - first + 1 }, (_, at) => first + at);

    const pendingLoad = loads.get(pending);
    const pendingBranch = mode === 'book' ? branchId : (pendingLoad?.busiest ?? branchId);
    const pendingClosed = isClosed(pending, schedule, pendingBranch);

    const branchOf = (id: string | null) => nameOf(branches, id);
    const scopeLabel = scope ? (branchOf(scope) ?? t('this branch')) : t('all branches');
    const movesTo =
        mode === 'open' && pendingLoad?.busiest && pendingLoad.busiest !== branchId
            ? pendingLoad.busiest
            : null;
    const movesToName = branchOf(movesTo);

    function cycleScope() {
        const at = branches.findIndex((row) => row.id === scope);
        const next = at + 1 >= branches.length ? null : (branches[at + 1]?.id ?? null);
        lastScope = next;
        setScope(next);
    }

    const pick = useCallback((day: string) => setPaging((now) => ({ ...now, pending: day })), []);

    function settle() {
        setPaging((now) => ({ ...now, leaving: null }));
    }

    function goToMonth(step: number) {
        setPaging((now) => {
            const next = addMonths(now.month, step);
            const nextDays = monthDays(next);
            const drawn = now.month === month;
            return {
                month: next,
                pending: nextDays.includes(today) ? today : (nextDays[0] ?? next),
                leaving: {
                    origin: now.leaving?.origin ?? now.month,
                    month: now.month,
                    loads: drawn ? loads : NO_LOADS,
                    counting: drawn ? counting : true,
                    pending: now.pending,
                },
            };
        });
    }

    function slide(step: number, velocity: number) {
        'worklet';
        aim.value += step;
        position.value = slideTo(aim.value, velocity, reducedMotion, settle);
    }

    function turn(step: number) {
        goToMonth(step);
        scheduleOnUI(slide, step, 0);
    }

    const swipe = Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-16, 16])
        .onStart(() => {
            start.value = position.value;
        })
        .onUpdate(({ translationX }) => {
            if (width.value > 0) position.value = start.value - (translationX * forward) / width.value;
        })
        .onEnd(({ translationX, velocityX }, success) => {
            const flung = Math.abs(velocityX) >= SWIPE_VELOCITY ? velocityX : 0;
            const toward = !success ? 0 : Math.abs(translationX) >= SWIPE_DISTANCE ? translationX : flung;
            const step = toward === 0 ? 0 : toward * forward < 0 ? 1 : -1;
            if (step !== 0) scheduleOnRN(goToMonth, step);
            slide(step, width.value > 0 ? (-velocityX * forward) / width.value : 0);
        });

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            testID="calendar-sheet"
            footer={
                <Button
                    label={
                        mode === 'book'
                            ? 'Use this day'
                            : movesToName
                              ? t('Go to this day in {branch}', { branch: movesToName })
                              : 'Go to this day'
                    }
                    block
                    disabled={mode === 'book' && (pendingClosed || pending < today)}
                    onPress={() => {
                        onPick(pending, pendingBranch);
                        onClose();
                    }}
                />
            }
        >
            <GestureDetector gesture={swipe}>
                <View collapsable={false}>
                    <View style={styles.monthBar}>
                        <Text variant="title3" weight="semibold">
                            {formatMonth(month)}
                        </Text>
                        <View style={styles.monthNav}>
                            <IconButton
                                accessibilityLabel="Previous month"
                                icon={<Chevron direction="back" tone="ink" size={9} />}
                                variant="square"
                                pressLockMs={0}
                                onPress={() => turn(-1)}
                            />
                            <IconButton
                                accessibilityLabel="Next month"
                                icon={<Chevron direction="forward" tone="ink" size={9} />}
                                variant="square"
                                pressLockMs={0}
                                onPress={() => turn(1)}
                            />
                        </View>
                    </View>

                    <WeekdayHeader />

                    <View
                        style={styles.viewport}
                        onLayout={(event) => {
                            const next = event.nativeEvent.layout.width;
                            setViewport(next);
                            width.value = next;
                        }}
                    >
                        <Animated.View style={[styles.strip, strip]}>
                            {pages.map((at) => {
                                const key = addMonths(month, at - page);
                                const current = at === page;
                                const left =
                                    !current && leaving && monthIndex(leaving.month) - base === at
                                        ? leaving
                                        : null;
                                return (
                                    <View
                                        key={key}
                                        pointerEvents={current ? 'auto' : 'none'}
                                        importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
                                        accessibilityElementsHidden={!current}
                                        style={[
                                            styles.page,
                                            { transform: [{ translateX: at * viewport * forward }] },
                                        ]}
                                    >
                                        <MonthPage
                                            month={key}
                                            loads={current ? loads : (left?.loads ?? NO_LOADS)}
                                            counting={current ? counting : (left?.counting ?? true)}
                                            pending={current ? pending : (left?.pending ?? null)}
                                            today={today}
                                            schedule={schedule}
                                            branchId={branchId}
                                            mode={mode}
                                            branches={branches}
                                            onPick={current ? pick : undefined}
                                        />
                                    </View>
                                );
                            })}
                        </Animated.View>
                    </View>
                </View>
            </GestureDetector>

            <View style={styles.legend}>
                <Legend tone={color.accent} label="booked load" />
                <Legend tone={color.due} label="fully booked" />
                {branches.length > 1 ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('Counting {scope}, next branch', { scope: scopeLabel })}
                        onPress={cycleScope}
                        style={styles.legendBranch}
                    >
                        <Text variant="caption" weight="semibold" tone="ink">
                            {scopeLabel}
                        </Text>
                        <Chevron direction="forward" tone="ink" size={7} />
                    </Pressable>
                ) : (
                    <View style={styles.legendBranch}>
                        <Text variant="caption" weight="semibold" tone="ink">
                            {branchOf(branchId) ?? ''}
                        </Text>
                    </View>
                )}
            </View>

            <View style={styles.summary}>
                <Text variant="subhead" weight="semibold">
                    {formatDate(pending)}
                </Text>
                {counting ? (
                    <Text variant="footnote" tone="muted">
                        {t('Counting the month…')}
                    </Text>
                ) : query.status === 'error' && query.error ? (
                    <View style={styles.summaryError}>
                        <Text variant="footnote" tone="due">
                            {describeError(query.error, 'day').title}
                        </Text>
                        <Button label="Try again" variant="text" size="md" onPress={query.refetch} />
                    </View>
                ) : (
                    <>
                        <Text variant="footnote" tone="muted">
                            {mode === 'book' && pending < today
                                ? t('That day has gone — pick one from today on.')
                                : pendingClosed
                                  ? t('Closed that day.')
                                  : pendingLoad && pendingLoad.count > 0
                                    ? `${t('{used} of {slots} slots', { used: pendingLoad.used, slots: pendingLoad.slots })}${
                                          pendingLoad.firstAt
                                              ? ` · ${t('first {time}', { time: firstLabel(pendingLoad.firstAt) })}`
                                              : ''
                                      }`
                                    : t('Nothing booked yet.')}
                        </Text>
                        {movesToName ? (
                            <Text variant="footnote" tone="accent">
                                {t('Most of it is in {name} — the day opens there.', { name: movesToName })}
                            </Text>
                        ) : null}
                    </>
                )}
            </View>
        </Sheet>
    );
}

type MonthPageProps = {
    month: string;
    loads: ReadonlyMap<string, DayLoad>;
    counting: boolean;
    pending: string | null;
    today: string;
    schedule: readonly ClinicDay[] | undefined;
    branchId: string | null;
    mode: 'open' | 'book';
    branches: readonly Branch[];
    onPick?: (dateKey: string) => void;
};

const MonthPage = memo(function MonthPage({
    month,
    loads,
    counting,
    pending,
    today,
    schedule,
    branchId,
    mode,
    branches,
    onPick,
}: MonthPageProps) {
    const t = useT();

    return (
        <WeekRows
            month={month}
            rowHeight={CELL + space[2]}
            renderDay={(day) => {
                const load = loads.get(day);
                const closed = isClosed(day, schedule, mode === 'book' ? branchId : undefined);
                const past = day < today;
                const picked = day === pending;
                const full = (load?.fill ?? 0) >= FULL_AT;
                const fillTone = fillOf({ picked, full, closed });
                const unbookable = mode === 'book' && (past || isClosed(day, schedule, branchId));

                return (
                    <Pressable
                        key={day}
                        disabled={unbookable}
                        accessibilityRole="button"
                        accessibilityState={{ selected: picked, disabled: unbookable }}
                        accessibilityLabel={[
                            day,
                            closed ? t('closed') : null,
                            counting
                                ? t('still counting')
                                : load
                                  ? t('{count} booked', { count: load.count })
                                  : null,
                            load?.busiest && load.busiest !== branchId
                                ? t('mostly in {branch}', {
                                      branch: nameOf(branches, load.busiest) ?? t('another branch'),
                                  })
                                : null,
                        ]
                            .filter(Boolean)
                            .join(', ')}
                        onPress={() => onPick?.(day)}
                        style={styles.cell}
                    >
                        <View style={styles.cellBox}>
                            <View style={[styles.fill, { backgroundColor: fillTone }]} />
                            {closed ? <View pointerEvents="none" style={styles.closedEdge} /> : null}
                            {!picked && !closed && day === today ? (
                                <View pointerEvents="none" style={styles.todayRing} />
                            ) : null}

                            <Text
                                variant="callout"
                                script="sans"
                                weight="bold"
                                tone={picked ? 'inverse' : closed || past || unbookable ? 'muted' : 'ink'}
                            >
                                {dayOfMonth(day)}
                            </Text>

                            <View
                                style={[
                                    styles.load,
                                    counting
                                        ? {
                                              width: closed ? 0 : PENDING_LOAD_WIDTH,
                                              backgroundColor: color.line,
                                          }
                                        : {
                                              width: Math.min(load?.count ?? 0, 4) * 4,
                                              backgroundColor:
                                                  !load || closed || load.count === 0
                                                      ? 'transparent'
                                                      : full
                                                        ? color.due
                                                        : color.accent,
                                          },
                                ]}
                            />
                        </View>
                    </Pressable>
                );
            }}
        />
    );
});

function fillOf({ picked, full, closed }: { picked: boolean; full: boolean; closed: boolean }): string {
    if (picked) return color.ink;
    if (full) return color.dueSoft;
    if (closed) return color.canvas;
    return 'transparent';
}

function nameOf(branches: readonly Branch[], id: string | null): string | undefined {
    return branches.find((row) => row.id === id)?.name;
}

function firstLabel(iso: string): string {
    const { time, meridiem } = time12(iso);
    return `${time} ${meridiem}`;
}

function Legend({ tone, label }: { tone: string; label: string }) {
    return (
        <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: tone }]} />
            <Text variant="caption" tone="muted">
                {label}
            </Text>
        </View>
    );
}

const CELL = size.row;

const styles = StyleSheet.create({
    monthBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: space[3],
    },
    monthTitle: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
    monthNav: { flexDirection: 'row', gap: space[1.5] },
    viewport: {
        height: space[1] + 6 * (CELL + space[2]),
        marginHorizontal: -size.gutter,
        overflow: 'hidden',
    },
    strip: { flex: 1 },
    page: { position: 'absolute', top: 0, start: 0, end: 0, paddingHorizontal: size.gutter },
    cell: { flex: 1, padding: space[0.5] },
    cellBox: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1],
        borderRadius: radius.md,
        overflow: 'hidden',
    },
    fill: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
    closedEdge: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        borderRadius: radius.md,
    },
    todayRing: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        borderWidth: border.thick,
        borderColor: color.ink,
        borderRadius: radius.md,
    },
    load: { height: 3, borderRadius: radius.full, overflow: 'hidden' },
    legend: { flexDirection: 'row', alignItems: 'center', gap: space[4], marginTop: space[4] },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    legendSwatch: { width: space[4], height: 3, borderRadius: radius.full },
    legendBranch: {
        marginStart: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[2],
        paddingVertical: space[0.5],
        backgroundColor: color.canvas,
        borderRadius: radius.full,
    },
    summary: {
        marginTop: space[3.5],
        gap: space[1],
        padding: space[3.5],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.card,
    },
    summaryError: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
