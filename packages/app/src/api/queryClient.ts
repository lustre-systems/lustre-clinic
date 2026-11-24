import { QueryClient } from '@tanstack/react-query';
import { classifyError } from './errors';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 120_000,
            gcTime: 24 * 60 * 60 * 1000,
            networkMode: 'always',
            retry: (failureCount, error) => failureCount < 1 && classifyError(error).retryable,
            retryDelay: 300,
            refetchOnReconnect: false,
        },
        mutations: {
            networkMode: 'always',
            retry: false,
        },
    },
});
