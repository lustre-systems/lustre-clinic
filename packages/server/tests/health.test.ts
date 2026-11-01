import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ERROR_CODE, TRPC_ENDPOINT, WS_PATH } from '@lustre/shared';
import { utcOffsetMinutes } from '@lustre/shared/zoneSpans';
import { setupDatabase } from './helpers/db.ts';
import { startTestServer, type TestServer } from './helpers/trpc.ts';

/**
 * Exercises the real transport — Bun.serve, the tRPC fetch adapter, and the
 * inferred `AppRouter` type the app consumes. Phase 0 is done when this is
 * green (SPEC §18).
 */

let server: TestServer;
let baseUrl: string;

const client = () => server.client;

beforeAll(async () => {
    await setupDatabase();
    server = startTestServer();
    baseUrl = server.baseUrl;
});

afterAll(() => {
    server.stop();
});

describe('health.clock', () => {
    test("reports this machine's time and the clinic's offset", async () => {
        const before = Date.now();
        const result = await client().health.clock.query();

        expect(result.now).toBeGreaterThanOrEqual(before);
        expect(result.now).toBeLessThanOrEqual(Date.now());
        expect([120, 180]).toContain(result.utcOffsetMinutes);
    });

    // The table the app converts every time with. It has to cover today, and
    // agree with the offset reported beside it.
    test("carries the clinic zone's offsets around now", async () => {
        const { now, utcOffsetMinutes: offset, zone } = await client().health.clock.query();
        expect(zone.zone).toBe('Africa/Cairo');
        expect(zone.spans[0]?.[0]).toBeLessThan(now - 365 * 86_400_000);
        const current = zone.spans.findLast(([from]) => from <= now);
        expect(current?.[1]).toBe(offset);
    });

    // Cairo keeps summer time from the last Friday of April to the last
    // Thursday of October. A handset left on +2 in September is the bug this
    // endpoint exists to catch, so the offset has to follow the season.
    test("follows the clinic's summer time", () => {
        expect(utcOffsetMinutes('Africa/Cairo', new Date('2026-09-24T12:00:00Z'))).toBe(180);
        expect(utcOffsetMinutes('Africa/Cairo', new Date('2026-12-24T12:00:00Z'))).toBe(120);
        expect(utcOffsetMinutes('UTC', new Date('2026-09-24T12:00:00Z'))).toBe(0);
    });
});

describe('health.check', () => {
    test('reports the database and the applied migration', async () => {
        const result = await client().health.check.query();

        expect(result.ok).toBe(true);
        expect(result.db).toBe(true);
        expect(result.migration).toBeString();
    });

    test('carries the tailnet address the app stores, null when unconfigured', () => {
        // The field must exist even when empty: the app reads it on every
        // connection, and an absent one would look like a server too old to ask.
        expect(client().health.check.query()).resolves.toHaveProperty('tailscale', null);
    });

    // A dev build connects only to a server that says development, so the
    // field is always there and the test server (NODE_ENV=test) is one.
    test('says which stack answered', async () => {
        expect((await client().health.check.query()).environment).toBe('development');
    });

    test('is reachable over plain HTTP GET, as the connection probe expects', async () => {
        const res = await fetch(`${baseUrl}${TRPC_ENDPOINT}/health.check`);
        expect(res.status).toBe(200);

        const body = (await res.json()) as { result: { data: { ok: boolean } } };
        expect(body.result.data.ok).toBe(true);
    });
});

describe('transport', () => {
    test('batches multiple calls into one request', async () => {
        const trpc = client();
        server.resetRequestCount();

        const [a, b] = await Promise.all([trpc.health.check.query(), trpc.health.check.query()]);

        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        expect(server.requestCount()).toBe(1);
    });

    test('returns 404 for an unknown path', async () => {
        const res = await fetch(`${baseUrl}/nope`);
        expect(res.status).toBe(404);
    });

    test('rejects a non-upgrade request to the websocket path', async () => {
        const res = await fetch(`${baseUrl}${WS_PATH}`);
        expect(res.status).toBe(426);
    });

    test('accepts a websocket upgrade', async () => {
        const ws = new WebSocket(server.wsUrl);
        const opened = await new Promise<boolean>((resolve) => {
            ws.onopen = () => resolve(true);
            ws.onerror = () => resolve(false);
        });
        ws.close();
        expect(opened).toBe(true);
    });
});

describe('errorFormatter', () => {
    test('carries an appCode on an unknown procedure', async () => {
        const res = await fetch(`${baseUrl}${TRPC_ENDPOINT}/does.notExist`);
        const body = (await res.json()) as { error: { data: { appCode: string } } };

        expect(body.error.data.appCode).toBe(ERROR_CODE.NOT_FOUND);
    });
});
