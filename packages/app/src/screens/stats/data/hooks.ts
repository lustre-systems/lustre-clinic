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

function useFreshAfterReset(): void {
    useSyncExternalStore(subscribeToDataReset, dataGeneration);
}

export function useTakings(range: DateRange): QueryResult<TakingsReport> {
    useFreshAfterReset();
    const trpc = useTRPC();
    return shape(useQuery(trpc.balance.takings.queryOptions(range)));
}

export function useStatsOverview(range: DateRange, enabled = true): QueryResult<StatsFigures> {
    useFreshAfterReset();
    const trpc = useTRPC();
    return shape(useQuery({ ...trpc.stats.overview.queryOptions(range), enabled }));
}

export function useStatsTrend(ranges: DateRange[]): QueryResult<StatsFigures[]> {
    useFreshAfterReset();
    const trpc = useTRPC();
    return shape(useQuery(trpc.stats.trend.queryOptions({ periods: ranges })));
}
