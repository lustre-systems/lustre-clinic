/**
 * Every call the money cluster makes, over the real tRPC client. This replaced
 * `_LocalMoneyApi.ts`, an in-memory store behind TanStack-Query-shaped hooks —
 * a payment recorded against it updated the screen and was gone on reload.
 *
 * The hooks keep that module's names and return shape, so the screens changed
 * their import and little else. Two things they no longer carry:
 *
 * - **No `version`.** The stub had no cache, so a payment three panes deep
 *   bumped a counter every query re-keyed on. There is a real cache now, and
 *   `recordPayment` invalidates `balance` and `visit` on success. Keeping a
 *   hand-rolled cache key beside a query cache is how you end up reconciling
 *   two of them.
 * - **No latency switch.** `setStubFailing` existed to make the failure states
 *   visible; a server that is off does that now.
 *
 * `error` is an `ERROR_CODE`, never a message: the client localizes from the
 * code and never parses what the server said (§4, §14). `isLoading` is
 * `isPending` — no data yet, which is the question a skeleton is asking.
 */
import type { ErrorCode } from '@lustre/shared';
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { dataGeneration, errorCodeOf, subscribeToDataReset, useTRPC } from '../../../api';
import type { DateRange } from '../money';
import type { StatsFigures, TakingsReport } from './types';

export type QueryResult<T> = {
    data: T | undefined;
    isLoading: boolean;
    error: ErrorCode | null;
    refetch: () => void;
};

type RawQuery = {
    data: unknown;
    isPending: boolean;
    error: unknown;
    refetch: () => unknown;
};

/** The one place the `Date`-to-string bridge in `types.ts` is actually applied. */
function shape<T>(query: RawQuery): QueryResult<T> {
    return {
        data: query.data as T | undefined,
        isLoading: query.isPending,
        error: query.error ? errorCodeOf(query.error) : null,
        refetch: () => {
            void query.refetch();
        },
    };
}

/**
 * Re-renders when the backend underneath changes (demo in or out, a new role).
 * The cache is cleared then, but the Stats tab is mounted, hidden and memoised,
 * so nothing else would make its queries look again and it would keep painting
 * the other clinic's figures until a pull.
 */
function useFreshAfterReset(): void {
    useSyncExternalStore(subscribeToDataReset, dataGeneration);
}

export function useTakings(range: DateRange): QueryResult<TakingsReport> {
    useFreshAfterReset();
    const trpc = useTRPC();
    return shape(useQuery(trpc.balance.takings.queryOptions(range)));
}

/** The whole of one range. Asked only while `enabled`: "All time" is the one pill whose header is not a chart point. */
export function useStatsOverview(range: DateRange, enabled = true): QueryResult<StatsFigures> {
    useFreshAfterReset();
    const trpc = useTRPC();
    return shape(useQuery({ ...trpc.stats.overview.queryOptions(range), enabled }));
}

/** One point per range, oldest first: the chart and the branch bars. */
export function useStatsTrend(ranges: DateRange[]): QueryResult<StatsFigures[]> {
    useFreshAfterReset();
    const trpc = useTRPC();
    return shape(useQuery(trpc.stats.trend.queryOptions({ periods: ranges })));
}
