import {
    type UseQueryResult,
    useInfiniteQuery,
    useQueries,
    useQueryClient,
    useMutation as useTanstackMutation,
    useQuery as useTanstackQuery,
} from '@tanstack/react-query';
// biome-ignore lint/style/noRestrictedImports: follows the other phone's writes over `/ws`, a subscription outside React
import { useCallback, useEffect, useRef } from 'react';
import { type Area, onServerChange } from '../../../api';

const PATIENTS_KEY = 'patients';

export interface QueryResult<T> {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    refetch: () => void;
}

export function useQuery<T>(
    key: readonly unknown[],
    run: () => Promise<T>,
    options: { enabled?: boolean } = {},
): QueryResult<T> {
    const query = useTanstackQuery({
        queryKey: [PATIENTS_KEY, ...key],
        queryFn: run,
        enabled: options.enabled ?? true,
    });

    return resultOf(query);
}

function resultOf<T>(query: UseQueryResult<T, Error>): QueryResult<T> {
    return {
        data: query.data,
        error: query.error ?? undefined,
        loading: query.isLoading,
        refetch: () => void query.refetch(),
    };
}

export function useQueryEach<T>(
    queries: readonly { key: readonly unknown[]; run: () => Promise<T> }[],
    options: { enabled?: boolean } = {},
): QueryResult<T>[] {
    const results = useQueries({
        queries: queries.map((query) => ({
            queryKey: [PATIENTS_KEY, ...query.key],
            queryFn: query.run,
            enabled: options.enabled ?? true,
        })),
    });
    return results.map(resultOf);
}

export interface PagedResult<T> {
    pages: T[] | undefined;
    error: Error | undefined;
    moreError: Error | undefined;
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    refetch: () => void;
    loadMore: () => void;
}

export function usePagedQuery<T>(
    key: readonly unknown[],
    run: (offset: number) => Promise<T>,
    nextOffset: (page: T, offset: number) => number | undefined,
    options: { enabled?: boolean } = {},
): PagedResult<T> {
    const query = useInfiniteQuery({
        queryKey: [PATIENTS_KEY, ...key],
        queryFn: ({ pageParam }) => run(pageParam),
        initialPageParam: 0,
        getNextPageParam: (page, _pages, offset) => nextOffset(page, offset),
        enabled: options.enabled ?? true,
    });
    const moreFailed = query.isFetchNextPageError;

    return {
        pages: query.data?.pages,
        error: moreFailed ? undefined : (query.error ?? undefined),
        moreError: moreFailed ? (query.error ?? undefined) : undefined,
        loading: query.isLoading,
        loadingMore: query.isFetchingNextPage,
        hasMore: query.hasNextPage,
        refetch: () => void query.refetch(),
        loadMore: () => {
            if (query.hasNextPage && !query.isFetching) void query.fetchNextPage();
        },
    };
}

export interface MutationResult<TInput, TOutput> {
    mutate: (input: TInput) => Promise<TOutput | undefined>;
    pending: boolean;
    error: Error | undefined;
    reset: () => void;
}

export function useMutation<TInput, TOutput>(
    run: (input: TInput) => Promise<TOutput>,
): MutationResult<TInput, TOutput> {
    const invalidate = useInvalidatePatients();

    const mutation = useTanstackMutation({ mutationFn: run, onSuccess: invalidate });
    const inFlight = useRef(false);

    const { mutateAsync } = mutation;
    const mutate = useCallback(
        async (input: TInput) => {
            if (inFlight.current) return undefined;
            inFlight.current = true;

            const result = await mutateAsync(input).catch(() => undefined);
            inFlight.current = false;
            return result;
        },
        [mutateAsync],
    );

    return {
        mutate,
        pending: mutation.isPending,
        error: mutation.error ?? undefined,
        reset: mutation.reset,
    };
}

export function useInvalidatePatients(): () => void {
    const client = useQueryClient();
    return useCallback(() => void client.invalidateQueries({ queryKey: [PATIENTS_KEY] }), [client]);
}

const READS: readonly Area[] = [
    'patient',
    'visit',
    'appointment',
    'balance',
    'procedure',
    'customQuestion',
    'branch',
    'settings',
];

export function useFollowServerChanges(): void {
    const invalidate = useInvalidatePatients();
    useEffect(
        () =>
            onServerChange((areas) => {
                if (areas === 'all' || READS.some((area) => areas.has(area))) invalidate();
            }),
        [invalidate],
    );
}
