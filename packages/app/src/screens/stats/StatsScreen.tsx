// The owner's stats: profit, revenue, cost and new patients over the period the
// pills pick, against `stats-screen-final` (the Stats screen design on the task
// page). Only the admin's phone has this tab (`seesStats`), and the server
// refuses its reads to anyone else.
//
// The header and the tiles are the whole period; the chart's points are what is
// inside it — the hours of today, the days of this week, the weeks of this
// month, the months of this year, the years of all time. Tapping a point narrows
// everything under the pills to it, and tapping it again goes back to the
// period. The change chip compares the period with the same stretch the period
// before (`comparisonRange`).
//
// Every figure is the server's. The client picks the ranges, compares two of
// them and lays the points out (`stats.ts`).
// biome-ignore lint/style/noRestrictedImports: two of them, both external — the imperative `scrollTo` when the tab is re-tapped, and the `AppState` subscription and timer that re-read the clock
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { serverNow } from '../../api/serverClock';
import { ScreenHeader, usePullToRefresh } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { color, size, space } from '../../theme';
import { minutesOfDay, todayKey } from '../day/time';
import { BranchBars } from './components/BranchBars';
import { LoadState, SkeletonCard, SkeletonHeroCard } from './components/LoadState';
import { MetricTiles } from './components/MetricTiles';
import { PeriodTabs } from './components/PeriodTabs';
import { StatsChart } from './components/StatsChart';
import { TakingsCard } from './components/TakingsCard';
import { type StatsFigures, useStatsOverview, useStatsTrend, useTakings } from './data';
import { PERIOD_LABEL, type Period, periodRange } from './money';
import {
    branchOrder,
    comparisonRange,
    deltaOf,
    emptyLead,
    METRICS,
    type Metric,
    metricOf,
    shownTakings,
    trendSlots,
} from './stats';

type StatsScreenProps = {
    /** Bumped when the Stats tab is tapped while it is already up: back to the top. */
    goHome?: number;
};

function StatsScreenView({ goHome = 0 }: StatsScreenProps) {
    const t = useT();
    const locale = useLocale();
    const [period, setPeriod] = useState<Period>('month');
    const [picked, setPicked] = useState<number | null>(null);
    const [metric, setMetric] = useState<Metric>('profit');
    const [{ today, minute }, rereadNow] = useNow();

    // The locale is in the key because the slots carry their labels.
    const slots = useMemo(() => trendSlots(period, today, locale, minute), [period, today, locale, minute]);
    const trend = useStatsTrend(slots.map((slot) => slot.range));
    const whole = useMemo(() => periodRange(period, today), [period, today]);
    const overview = useStatsOverview(whole);
    const before = useMemo(
        () => comparisonRange(period, today, minute, locale),
        [period, today, minute, locale],
    );
    const comparison = useStatsOverview(before?.range ?? whole, before !== null);

    // Hours before the first visit of the day, and years before the clinic's
    // first, are dropped from the front rather than drawn as a run of zeros.
    const trims = period === 'today' || period === 'all';
    const lead = trims && trend.data ? emptyLead(trend.data) : 0;
    const points = trend.data?.slice(lead) ?? [];
    const shown = slots.slice(lead);
    const labels = shown.map((slot) => slot.axis);

    const selected = picked !== null && picked < points.length ? picked : -1;
    const focus = selected >= 0 ? points[selected] : undefined;
    const current: StatsFigures | undefined = focus ?? overview.data;
    const name = focus ? (shown[selected]?.name ?? '') : t(PERIOD_LABEL[period]);

    // An hour is narrower than the takings can be asked for, so a selected
    // hour shows the day's.
    const takingsRange = focus && period !== 'today' ? (shown[selected]?.range ?? whole) : whole;
    const takings = useTakings(takingsRange);

    function pickPeriod(next: Period) {
        setPeriod(next);
        setPicked(null);
    }

    function selectPoint(index: number) {
        setPicked((current) => (current === index ? null : index));
    }

    const scroller = useRef<ScrollView>(null);
    const home = useRef(goHome);
    useEffect(() => {
        if (home.current === goHome) return;
        home.current = goHome;
        scroller.current?.scrollTo({ y: 0, animated: true });
    }, [goHome]);

    const pull = usePullToRefresh(
        () => {
            rereadNow();
            trend.refetch();
            overview.refetch();
            if (before) comparison.refetch();
            takings.refetch();
        },
        trend.isLoading || overview.isLoading || takings.isLoading,
    );

    const figures = current
        ? (Object.fromEntries(METRICS.map((key) => [key, metricOf(current, key)])) as Record<Metric, number>)
        : null;
    const branchesShown = branchOrder(points).length > 1;
    const headLoading = trend.isLoading || overview.isLoading;
    const headError = trend.error ?? overview.error;
    const retryHead = () => {
        trend.refetch();
        overview.refetch();
    };
    // Only the whole period is compared. Two points side by side are rarely
    // the same length — a three-day first week against a whole one — and a
    // change between them would be the calendar's, not the clinic's.
    const previous = focus ? undefined : comparison.data;
    const against = focus ? null : (before?.label ?? null);

    return (
        <ScrollView
            ref={scroller}
            style={styles.screen}
            contentContainerStyle={styles.content}
            refreshControl={pull.refreshControl}
            {...pull.scrollProps}
            testID="stats-screen"
        >
            <ScreenHeader title="Stats" />

            <PeriodTabs value={period} onChange={pickPeriod} />

            <View style={styles.body}>
                <LoadState
                    isLoading={headLoading}
                    error={headError}
                    onRetry={retryHead}
                    skeleton={
                        <>
                            <SkeletonHeroCard height={220} />
                            <SkeletonCard height={260} />
                        </>
                    }
                >
                    {current && figures ? (
                        <>
                            <StatsChart
                                metric={metric}
                                value={figures[metric]}
                                name={name}
                                period={t(PERIOD_LABEL[period])}
                                delta={
                                    previous
                                        ? deltaOf(figures[metric], metricOf(previous, metric), metric)
                                        : null
                                }
                                against={against}
                                values={points.map((point) => metricOf(point, metric))}
                                labels={labels}
                                selected={selected}
                                onSelect={selectPoint}
                            />

                            <MetricTiles figures={figures} metric={metric} onSelect={setMetric} />

                            {branchesShown ? (
                                <BranchBars
                                    points={points}
                                    labels={labels}
                                    names={shown.map((slot) => slot.name)}
                                    total={overview.data}
                                    periodName={t(PERIOD_LABEL[period])}
                                    selected={selected}
                                    onSelect={selectPoint}
                                />
                            ) : null}
                        </>
                    ) : null}
                </LoadState>

                <LoadState
                    isLoading={takings.isLoading}
                    error={takings.error}
                    onRetry={takings.refetch}
                    skeleton={<SkeletonCard height={220} />}
                >
                    {takings.data ? (
                        <TakingsCard
                            takings={shownTakings(takings.data)}
                            label={t('Collected · {period}', {
                                period: takingsRange === whole ? t(PERIOD_LABEL[period]) : name,
                            })}
                        />
                    ) : null}
                </LoadState>
            </View>
        </ScrollView>
    );
}

/**
 * Thin as the props are, the memo is the boundary that keeps the whole screen
 * out of a tab switch: `goHome` comes from the shell unchanged.
 */
export const StatsScreen = memo(StatsScreenView);

// Which local day, and which minute of it, the pills are measured from. The
// shell mounts a tab once and hides it rather than unmounting it, and a desk
// phone can sit on it all day, so both are re-read on a timer as well as when
// the app comes back to the foreground and on every pull. Without the timer
// "Today" stops adding hours and the change chip keeps comparing with
// yesterday up to the minute the tab was first opened.
//
// The minute moves in steps of five: it is in the comparison's query key, and
// a refetch every minute buys nothing a five-minute-old comparison does not
// already say. A re-read that lands on the same step keeps the same object, so
// it costs no render.
const STEP_MINUTES = 5;

function useNow(): [{ today: string; minute: number }, () => void] {
    const read = useCallback(
        () => ({
            today: todayKey(),
            minute: Math.floor(minutesOfDay(serverNow()) / STEP_MINUTES) * STEP_MINUTES,
        }),
        [],
    );
    const [now, setNow] = useState(read);

    const reread = useCallback(() => {
        const next = read();
        setNow((current) =>
            current.today === next.today && current.minute === next.minute ? current : next,
        );
    }, [read]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') reread();
        });
        const timer = setInterval(reread, STEP_MINUTES * 60_000);
        return () => {
            subscription.remove();
            clearInterval(timer);
        };
    }, [reread]);

    return [now, reread];
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    content: { paddingBottom: space[12] },
    body: { gap: space[3.5], paddingHorizontal: size.bleed, paddingTop: space[3.5] },
});
