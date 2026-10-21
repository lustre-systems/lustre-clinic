// The owner's stats: profit, revenue, cost and new patients over the period the
// pills pick, against `stats-screen-final` (the Stats screen design on the task
// page). Only the admin's phone has this tab (`seesStats`), and the server
// refuses its reads to anyone else.
//
// One point is selected at a time, the latest by default, and everything under
// the pills shows that point: the chart's header, the tiles, the highlighted
// branch bar and how people paid. "All time" draws the years with nothing
// selected and the whole history in the header; tapping a year there moves to
// "This year" with that year selected.
//
// Every figure is the server's. The client picks the ranges, compares a point
// with the one before it and lays the points out (`stats.ts`).
// biome-ignore lint/style/noRestrictedImports: two of them, both external — the imperative `scrollTo` when the tab is re-tapped, and the `AppState` subscription that re-reads the day on foreground
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { ScreenHeader, usePullToRefresh } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { color, size, space } from '../../theme';
import { todayKey } from '../day/time';
import { BranchBars } from './components/BranchBars';
import { LoadState, SkeletonCard, SkeletonHeroCard } from './components/LoadState';
import { MetricTiles } from './components/MetricTiles';
import { PeriodTabs } from './components/PeriodTabs';
import { StatsChart } from './components/StatsChart';
import { TakingsCard } from './components/TakingsCard';
import { type StatsFigures, useStatsOverview, useStatsTrend, useTakings } from './data';
import { type Period, periodRange } from './money';
import {
    branchOrder,
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
    const [period, setPeriod] = useState<Period>('month');
    const [picked, setPicked] = useState<number | null>(null);
    const [metric, setMetric] = useState<Metric>('profit');
    const [today, rereadToday] = useToday();

    const locale = useLocale();
    const allTime = period === 'all';
    // "All time" is the yearly line, so the two pills share one query. The
    // locale is in the key because the slots carry their labels.
    const slots = useMemo(
        () => trendSlots(allTime ? 'year' : period, today, locale),
        [allTime, period, today, locale],
    );
    const trend = useStatsTrend(slots.map((slot) => slot.range));
    const everything = useMemo(() => periodRange('all', today), [today]);
    const overview = useStatsOverview(everything, allTime);

    const yearly = period === 'year' || allTime;
    const lead = yearly && trend.data ? emptyLead(trend.data) : 0;
    const points = trend.data?.slice(lead) ?? [];
    const shown = slots.slice(lead);
    const labels = shown.map((slot) => slot.axis);

    const last = points.length - 1;
    const selected = allTime ? -1 : Math.min(picked ?? last, last);
    const current: StatsFigures | undefined = allTime ? overview.data : points[selected];
    const previous = selected > 0 ? points[selected - 1] : undefined;

    const takings = useTakings(allTime ? everything : (shown[selected]?.range ?? everything));

    function pickPeriod(next: Period) {
        setPeriod(next);
        setPicked(null);
    }

    function selectPoint(index: number) {
        if (allTime) setPeriod('year');
        setPicked(index);
    }

    const scroller = useRef<ScrollView>(null);
    const home = useRef(goHome);
    useEffect(() => {
        if (home.current === goHome) return;
        home.current = goHome;
        scroller.current?.scrollTo({ y: 0, animated: true });
    }, [goHome]);

    const pull = usePullToRefresh(() => {
        rereadToday();
        trend.refetch();
        if (allTime) overview.refetch();
        takings.refetch();
    }, trend.isLoading || takings.isLoading);

    const figures = current
        ? (Object.fromEntries(METRICS.map((key) => [key, metricOf(current, key)])) as Record<Metric, number>)
        : null;
    const branchesShown = branchOrder(points).length > 1;
    const headLoading = trend.isLoading || (allTime && overview.isLoading);
    const headError = trend.error ?? (allTime ? overview.error : null);
    const retryHead = () => {
        trend.refetch();
        if (allTime) overview.refetch();
    };

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
                                name={allTime ? t('All time') : (shown[selected]?.name ?? '')}
                                delta={
                                    previous
                                        ? deltaOf(figures[metric], metricOf(previous, metric), metric)
                                        : null
                                }
                                against={selected > 0 ? (labels[selected - 1] ?? null) : null}
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
                                period: allTime ? t('All time') : (shown[selected]?.name ?? ''),
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

// Which local day the pills are measured from. The shell mounts a tab once and
// hides it rather than unmounting it, so a day captured at first render would
// be yesterday's by the next morning; it is re-read when the app comes back to
// the foreground and on every pull. An unchanged day hashes to the same query
// key, so a re-read on the same day is not a refetch.
function useToday(): [string, () => void] {
    const [today, setToday] = useState(todayKey);

    const reread = useCallback(() => setToday(todayKey()), []);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') reread();
        });
        return () => subscription.remove();
    }, [reread]);

    return [today, reread];
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    content: { paddingBottom: space[12] },
    body: { gap: space[3.5], paddingHorizontal: size.bleed, paddingTop: space[3.5] },
});
