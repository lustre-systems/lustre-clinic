import type { AppRouter } from '@lustre/server/src/trpc/router.ts';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTRPCContext } from '@trpc/tanstack-react-query';
// biome-ignore lint/style/noRestrictedImports: starts the connection-recovery subscription, which outlives every screen and has nothing to do with rendering
import { type ReactNode, useEffect } from 'react';
import { trpcClient } from './client';
import { useServerEvents } from './live';
import { queryClient } from './queryClient';
import { startConnectionRecovery } from './recovery';

const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export { useTRPC };

function ServerEvents({ children }: { children: ReactNode }) {
    useServerEvents();
    useEffect(startConnectionRecovery, []);
    return <>{children}</>;
}

export function ApiProvider({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
                <ServerEvents>{children}</ServerEvents>
            </TRPCProvider>
        </QueryClientProvider>
    );
}
