import type { AppRouter } from '@lustre/server/src/trpc/router.ts';
import { DEVICE_TOKEN_HEADER, TRPC_ENDPOINT } from '@lustre/shared';
import { createTRPCClient, httpBatchLink, splitLink } from '@trpc/client';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { lastDoneLink } from '../lastDone/link';
import { noteApi } from '../reporting/trail';
import { timing } from './config';
import { markOffline, markOnline, resolveBaseUrl } from './connection';
import { credentialToken, hydrateCredential, noteRefusal, refusalIn } from './credential';
import { subscribeToDataReset } from './dataReset';
import { demoLink, deviceBackend } from './demo';
import { queryClient } from './queryClient';

const PLACEHOLDER_ORIGIN = 'http://server.invalid';

function withTimeout(init: RequestInit | undefined, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const caller = init?.signal;
    const forward = () => controller.abort();
    caller?.addEventListener('abort', forward);

    return {
        signal: controller.signal,
        done: () => {
            clearTimeout(timer);
            caller?.removeEventListener('abort', forward);
        },
    };
}

async function serverFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const base = await resolveBaseUrl();

    const requested = new URL(input instanceof Request ? input.url : String(input));
    const target = `${base}${requested.pathname}${requested.search}`;

    const { signal, done } = withTimeout(init, timing.requestMs);
    const started = Date.now();

    try {
        const response =
            input instanceof Request
                ? await fetch(new Request(target, input), { signal })
                : await fetch(target, { ...init, signal });
        markOnline();
        noteApi(requested.pathname, response.status, Date.now() - started);
        if (response.status === 401 || response.status === 207) void readRefusal(response.clone(), init);
        return response;
    } catch (error) {
        markOffline();
        noteApi(requested.pathname, null, Date.now() - started);
        throw error;
    } finally {
        done();
    }
}

function sentToken(init: RequestInit | undefined): string | null {
    const value = new Headers(init?.headers).get(DEVICE_TOKEN_HEADER);
    return value ? value.replace(/^Bearer\s+/i, '') : null;
}

async function readRefusal(response: Response, init: RequestInit | undefined): Promise<void> {
    const body: unknown = await response.json().catch(() => null);
    const refusal = refusalIn(body);
    if (refusal) noteRefusal(refusal, sentToken(init));
}

async function credentialHeaders(): Promise<Record<string, string>> {
    await hydrateCredential();
    const token = credentialToken();
    return token ? { [DEVICE_TOKEN_HEADER]: `Bearer ${token}` } : {};
}

export const trpcClient = createTRPCClient<AppRouter>({
    links: [
        lastDoneLink({
            appointment: (id): Promise<unknown> => trpcClient.appointment.byId.query({ id }),
            patient: (id): Promise<unknown> => trpcClient.patient.byId.query({ id }),
        }),
        splitLink({
            condition: () => deviceBackend() !== null,
            true: demoLink,
            false: httpBatchLink({
                url: `${PLACEHOLDER_ORIGIN}${TRPC_ENDPOINT}`,
                fetch: serverFetch,
                headers: credentialHeaders,
            }),
        }),
    ],
});

export const api = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });

subscribeToDataReset(() => queryClient.clear());
