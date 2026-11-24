import { expect } from 'bun:test';
import { DEVICE_TOKEN_HEADER, type ErrorCode, TRPC_ENDPOINT, WS_PATH, type WsFrame } from '@lustre/shared';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { Server } from 'bun';
import { createServer } from '../../src/server.ts';
import type { AppRouter } from '../../src/trpc/router.ts';
import type { WsData } from '../../src/ws/index.ts';

export type TestClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export interface TestServer {
    client: TestClient;
    clientAs(token: string): TestClient;
    baseUrl: string;
    endpoint: string;
    wsUrl: string;
    requestCount(): number;
    resetRequestCount(): void;
    stop(): void;
}

export function startTestServer(): TestServer {
    const server: Server<WsData> = createServer(0);
    const baseUrl = `http://localhost:${server.port}`;

    let requests = 0;
    const countingFetch = (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
        requests += 1;
        return fetch(input, init);
    };

    const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${baseUrl}${TRPC_ENDPOINT}`, fetch: countingFetch })],
    });

    return {
        client,
        clientAs: (token) =>
            createTRPCClient<AppRouter>({
                links: [
                    httpBatchLink({
                        url: `${baseUrl}${TRPC_ENDPOINT}`,
                        headers: { [DEVICE_TOKEN_HEADER]: `Bearer ${token}` },
                    }),
                ],
            }),
        baseUrl,
        endpoint: `${baseUrl}${TRPC_ENDPOINT}`,
        wsUrl: `ws://localhost:${server.port}${WS_PATH}`,
        requestCount: () => requests,
        resetRequestCount: () => {
            requests = 0;
        },
        stop: () => server.stop(true),
    };
}

const HeaderedWebSocket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
) => WebSocket;

export function socketAs(wsUrl: string, token: string): WebSocket {
    return new HeaderedWebSocket(wsUrl, { headers: { [DEVICE_TOKEN_HEADER]: `Bearer ${token}` } });
}

interface TrpcErrorData {
    appCode?: string;
    httpStatus?: number;
    code?: string;
}

function dataOf(err: unknown): TrpcErrorData {
    if (!(err instanceof TRPCClientError)) {
        throw new Error(`expected a TRPCClientError, got ${err instanceof Error ? err.message : typeof err}`);
    }
    return (err.data ?? {}) as TrpcErrorData;
}

export async function expectTrpcError(
    code: ErrorCode,
    httpStatus: number,
    fn: () => Promise<unknown>,
): Promise<void> {
    try {
        await fn();
    } catch (err) {
        const data = dataOf(err);
        expect(data.appCode).toBe(code);
        expect(data.httpStatus).toBe(httpStatus);
        return;
    }
    throw new Error(`expected ${code} (HTTP ${httpStatus}), but the call resolved`);
}

export async function expectValidationError(fn: () => Promise<unknown>): Promise<void> {
    await expectTrpcError('VALIDATION' as ErrorCode, 400, fn);
}

export async function captureWsEvents<T>(
    wsUrl: string,
    fn: () => Promise<T>,
): Promise<{ result: T; events: Record<string, string>[]; frames: WsFrame[] }> {
    const ws = new WebSocket(wsUrl);
    const frames: WsFrame[] = [];

    await new Promise<void>((resolve, reject) => {
        ws.onmessage = () => resolve();
        ws.onerror = () => reject(new Error('websocket failed to open'));
    });

    ws.onmessage = (event) => {
        frames.push(JSON.parse(String(event.data)) as WsFrame);
    };

    try {
        const result = await fn();
        await Bun.sleep(50);
        const events = frames.flatMap((frame) =>
            frame.type === 'event' ? [{ event: frame.event, ...(frame.id ? { id: frame.id } : {}) }] : [],
        );
        return { result, events, frames };
    } finally {
        ws.close();
    }
}
