// biome-ignore lint/style/noRestrictedImports: this file is the query layer — one effect is the fetch the key subscribes to, one follows the other phone's writes over `/ws`, the last tracks mount so a late answer does not set state on a gone screen
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { dataGeneration, onServerChange, subscribeToDataReset } from '../../../api';
import { asRequestError, type RequestError } from './client';

export type QueryStatus = 'loading' | 'success' | 'error';

export interface QueryResult<T> {
    data: T | undefined;
    status: QueryStatus;
    error: RequestError | null;
    refreshing: boolean;
    refetch: () => void;
}

export function useLocalQuery<T>(
    key: string,
    run: () => Promise<T>,
    options: { enabled?: boolean } = {},
): QueryResult<T> {
    const enabled = options.enabled ?? true;

    const generation = useSyncExternalStore(subscribeToDataReset, dataGeneration);

    const [data, setData] = useState<T | undefined>(undefined);
    const [error, setError] = useState<RequestError | null>(null);
    const [status, setStatus] = useState<QueryStatus>(enabled ? 'loading' : 'success');
    const [refreshing, setRefreshing] = useState(false);

    const runRef = useRef(run);
    runRef.current = run;

    const attempt = useRef(0);

    const load = useCallback(async (isRefresh: boolean) => {
        attempt.current += 1;
        const current = attempt.current;
        if (isRefresh) {
            setRefreshing(true);
        } else {
            setData(undefined);
            setStatus('loading');
        }

        try {
            const result = await runRef.current();
            if (attempt.current !== current) return;
            setData(result);
            setError(null);
            setStatus('success');
        } catch (err) {
            if (attempt.current !== current) return;
            setError(asRequestError(err));
            setStatus('error');
        } finally {
            if (attempt.current === current) setRefreshing(false);
        }
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the subscription
    useEffect(() => {
        if (!enabled) return;
        void load(false);
    }, [key, generation, enabled, load]);

    const refetch = useCallback(() => {
        void load(data !== undefined);
    }, [load, data]);

    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;
    useEffect(() => {
        if (!enabled) return;
        return onServerChange(() => refetchRef.current());
    }, [enabled]);

    return { data, status, error, refreshing, refetch };
}

export interface MutationHandlers<T> {
    onSuccess?: (result: T) => void;
    onError?: (error: RequestError) => void;
}

export interface MutationResult<I, T> {
    mutate: (input: I, handlers?: MutationHandlers<T>) => void;
    pending: boolean;
    error: RequestError | null;
    reset: () => void;
}

export function useLocalMutation<I, T>(run: (input: I) => Promise<T>): MutationResult<I, T> {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<RequestError | null>(null);

    const runRef = useRef(run);
    runRef.current = run;

    const inFlight = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const mutate = useCallback((input: I, handlers?: MutationHandlers<T>) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        setError(null);

        void (async () => {
            try {
                const result = await runRef.current(input);
                if (mounted.current) handlers?.onSuccess?.(result);
            } catch (err) {
                if (!mounted.current) return;
                const failure = asRequestError(err);
                setError(failure);
                handlers?.onError?.(failure);
            } finally {
                inFlight.current = false;
                if (mounted.current) setPending(false);
            }
        })();
    }, []);

    const reset = useCallback(() => setError(null), []);

    return { mutate, pending, error, reset };
}
