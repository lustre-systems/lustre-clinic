/**
 * A month, with how full each day is. The load bar is the reason this is not a
 * date picker — "is Thursday busy" is the question asked over the phone, and
 * counting by opening the day is how someone gets double-booked. The month is
 * one request (`api.byDates` batches via `httpBatchLink`), not thirty-one.
 * Cancelled and no-show rows hold no slot, so they do not make a day look
 * busy. The pick follows the month, so the grid, the summary and "Go to this
 * day" never describe different days.
 *
 * Every cell is one shape: `cellBox` owns the geometry and `fill` is the only
 * thing that paints it, so a state picks a colour and nothing else. That split
 * is not tidiness — it is the fix for square corners. Inside a `Pressable`,
 * Android drops the corner radius when it paints a descendant's background:
 * fully booked came out a hard square while closed and today, which carry a
 * border, came out round, because borders honour the radius when backgrounds
 * do not. What does hold is the clip, so the box clips (`overflow: 'hidden'`)
 * and the fill is a child it clips to shape. The load bar clips itself for the
 * same reason — it is a plain background in the same subtree, and drew as a
 * 3px rectangle rather than a pill. Anything painted in a cell from here on
 * wants the same treatment; a bare `backgroundColor` will come out square.
 *
 * The count is every branch, not the one the day view is on: a receptionist
 * asking "is Thursday busy" is asking about the clinic, and a month scoped to
 * Maadi reads as an empty month rather than a day somewhere else. What that
 * costs is a grid that can promise a day the day view then draws empty, so the
 * pick carries the branch that day is busiest in (`month.ts`) and the day view
 * moves with it. `branchOf` names that branch in the summary and on the
 * button, so the switch is read before it happens rather than noticed after.
 *
 * The pill under the legend cycles that scope — every branch, then each one in
 * turn. Booking into one branch is the other half of the phone call, and a
 * month counting three answers it with days that look busy somewhere else.
 * Scoping filters the month already fetched, so a cycle costs no request and
 * moves no pick, and the choice outlives the sheet (`lastScope`).
 */
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
import { addMonths, formatDate, formatMonth, monthDays, parseKey, time12, todayKey } from '../time';
import { WeekdayHeader, WeekRows } from './WeekRows';

export type CalendarSheetProps = {
    visible: boolean;
    selected: string;
    schedule: readonly ClinicDay[] | undefined;
    branches: readonly Branch[];
    branchId: string | null;
    /**
     * What picking a day is for. `open` is the day view: the pick moves the
     * screen onto that day, and takes the branch with it when the day is
     * busiest somewhere else — which is the whole reason the grid counts every
     * branch. `book` is the booking page, where the branch is a field the desk
     * has already answered above this sheet and a booking into Maadi does not
     * become a booking into Nasr City because March is busier there. So the
     * pick reports the day alone and every line about moving branch is dropped.
     */
    mode?: 'open' | 'book';
    onPick: (dateKey: string, branchId: string | null) => void;
    onClose: () => void;
};

const FULL_AT = 0.9;
/** Two slots' worth — a track, not a reading, and never wider than a real bar. */
const PENDING_LOAD_WIDTH = 8;
/** A third of a cell dragged, or a flick — either reads as meaning to page. */
const SWIPE_DISTANCE = 48;
const SWIPE_VELOCITY = 600;
/**
 * Critically damped, like the agenda row's `bounciness: 0` spring back: the
 * month settles against the edge instead of wobbling past it.
 */
const SLIDE = { duration: duration.push, dampingRatio: 1, overshootClamping: true } as const;
const NO_LOADS: ReadonlyMap<string, DayLoad> = new Map();

/** What the month being paged away from looked like, so it leaves as it was. */
type Leaving = {
    /** Where the run of pages started: rapid taps pass months still on screen. */
    origin: string;
    month: string;
    loads: ReadonlyMap<string, DayLoad>;
    counting: boolean;
    pending: string;
};

/**
 * One state, so a page is always taken from the month the last page landed
 * on. Taps faster than a render would otherwise each page from the same
 * stale month and land on it together.
 */
type Paging = { month: string; pending: string; leaving: Leaving | null };

function monthIndex(key: string): number {
    const date = parseKey(key);
    return date.getFullYear() * 12 + date.getMonth();
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

/**
 * The scope outlives the sheet: `DayScreen` remounts it by `seq` on every
 * open, so component state would forget a receptionist who works one branch
 * all morning. `null` counts every branch.
 */
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
    // For the one render after a page, the query still holds the month before,
    // and its rows would be laid over the new month's days as it slides in.
    const fetched = query.data?.month === month ? query.data.rows : undefined;

    const scoped =
        fetched && scope ? fetched.map((rows) => rows.filter((row) => row.branchId === scope)) : fetched;

    const loads = scoped ? loadsFrom(days, scoped, schedule, branchId) : new Map<string, DayLoad>();
    const today = todayKey();

    /**
     * Where the second went, measured rather than guessed: switching months
     * redraws the title and the whole grid in about 130ms — `monthDays` and
     * `loadsFrom` are sub-millisecond on a month — and then the load bars land
     * a third of a second later, because `useLocalQuery` is keyed on the month
     * and refetches all ~31 days. Nothing here is worth micro-optimising; the
     * grid was simply drawing a finished-looking month with every bar blank
     * while the count was still in flight, which reads as "empty" and then
     * changes under the reader. So the cells say they do not know yet.
     */
    const counting = query.status === 'loading' || (query.status === 'success' && !fetched);

    /**
     * Every month sits at a fixed place on one strip, counted from the month the
     * sheet opened on, and paging moves the strip rather than the months. So a
     * page never has to be put back in the middle after it lands, which is the
     * frame where the old month would flash before the new one draws.
     */
    const [base] = useState(() => monthIndex(selected));
    const page = monthIndex(month) - base;
    const position = useSharedValue(page);
    /** The page the strip is headed for, ahead of the render that lands it. */
    const aim = useSharedValue(page);
    const width = useSharedValue(0);
    const start = useSharedValue(0);
    const forward = isRTL ? -1 : 1;
    const strip = useAnimatedStyle(() => ({
        transform: [{ translateX: -position.value * width.value * forward }],
    }));

    // Unmeasured, every page would sit on top of the one on screen.
    const origin = leaving ? monthIndex(leaving.origin) - base : page;
    const first = viewport > 0 ? Math.min(page - 1, origin) : page;
    const last = viewport > 0 ? Math.max(page + 1, origin) : page;
    const pages = Array.from({ length: last - first + 1 }, (_, at) => first + at);

    const pendingLoad = loads.get(pending);
    // The grid below counts every branch on purpose, but this line describes the
    // one day the desk is about to open, so it asks the branch the pick will
    // actually land in. `branchId` is the screen's *resolved* branch, not the id
    // it has stored — an empty day has no `busiest`, and handing `pickDay` a null
    // there leaves the stored id alone and lets the new date resolve somewhere
    // else entirely. `onPick` is given `pendingBranch` so the day that opens is
    // the one this summary just described.
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
            // This render's counts only describe the month it drew.
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

    // On the UI thread even from an arrow: a shared value read back on JS
    // right after a write from JS is not the value just written, and rapid taps
    // would all aim for the same page.
    function slide(step: number, velocity: number) {
        'worklet';
        aim.value += step;
        position.value = slideTo(aim.value, velocity, reducedMotion, settle);
    }

    function turn(step: number) {
        goToMonth(step);
        scheduleOnUI(slide, step, 0);
    }

    // A swipe pages the way the arrows point: the next month comes in from the
    // forward edge, which is the right in English and the left in Arabic. The
    // offsets keep it out of the sheet's own vertical drag and off a tap on a
    // cell, and it only activates once the drag is plainly sideways. The grid
    // tracks the finger on the UI thread; only the landing month goes to JS.
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
                    // Paging to a month lands the pick on its first day, which
                    // can be one the branch is shut — the cells cannot be tapped
                    // onto such a day, but the button would still take it.
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
                        {/* `pressLockMs={0}` because paging is the one thing here meant to
                    be pressed repeatedly. The default lock exists to stop a
                    control answering twice; six months out is six deliberate
                    taps, and at any normal tapping speed the lock eats half. */}
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
    /** Only the month on screen takes a pick; the ones beside it are scenery. */
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
                // Booking asks about the branch on the form: a day that branch
                // is closed must look and read closed, not only refuse the tap.
                // The day view counts every branch.
                const closed = isClosed(day, schedule, mode === 'book' ? branchId : undefined);
                const past = day < today;
                const picked = day === pending;
                const full = (load?.fill ?? 0) >= FULL_AT;
                const fillTone = fillOf({ picked, full, closed });
                // On the booking page a day the branch cannot take is not a
                // pick at all: `daysOffered` would drop it and the booking
                // would land on some other day without a word. The day view
                // can look at any day, so it keeps every cell.
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
                        {/* Closed is a fact about the day, not an alternative
                    to selection: the dark fill says "picked" while
                    this dashed edge still says "closed".

                    Both edges are views over the fill, not borders
                    toggled on the clipped cell box. Android does not
                    reliably repaint such a border after the first
                    draw. A closed cell mounts its edge with the cell
                    and selection only changes the fill beneath it,
                    so moving the pick cannot make the treatment
                    disappear or depend on a repaint. */}
                        <View style={styles.cellBox}>
                            <View style={[styles.fill, { backgroundColor: fillTone }]} />
                            {closed ? <View pointerEvents="none" style={styles.closedEdge} /> : null}
                            {/* Not on a closed day either: the ring would hide
                        the dashed closed edge, and in booking mode
                        dress a day that cannot be picked as live. */}
                            {!picked && !closed && day === today ? (
                                <View pointerEvents="none" style={styles.todayRing} />
                            ) : null}

                            <Text
                                variant="callout"
                                // Instrument Sans, not the mono the rest of the
                                // cluster gives numbers: DM Mono stops at 500, and
                                // the grid is read at a glance, so it wants 700.
                                script="sans"
                                weight="bold"
                                tone={picked ? 'inverse' : closed || past || unbookable ? 'muted' : 'ink'}
                            >
                                {parseKey(day).getDate()}
                            </Text>

                            {/* A track where the bar will be, so a month
                        mid-count reads as unknown rather than as
                        empty. Closed days never carry a bar, so
                        they stay blank and do not promise one. */}
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

/**
 * The pick reads over how busy the day is, and both read over a closed day —
 * a shut Friday that is also the pick is a pick first.
 */
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
    // Out to the sheet's edges, so a month slides off the sheet rather than
    // vanishing at the gutter.
    // Six weeks whatever the month, so the sheet does not change height under
    // a month sliding in, and the arrows stay where the last tap found them.
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
