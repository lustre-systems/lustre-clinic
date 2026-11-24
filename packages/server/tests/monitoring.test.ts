import { describe, expect, test } from 'bun:test';
import { type Alert, createAlerter, discordSender, formatAlert, scrub } from '../src/monitoring/alert.ts';
import { startHeartbeat } from '../src/monitoring/heartbeat.ts';

interface Sent {
    alert: Alert;
    text: string;
}

function recorder() {
    const sent: Sent[] = [];
    return {
        sent,
        send: async (alert: Alert, text: string) => {
            sent.push({ alert, text });
        },
    };
}

function clock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('scrub', () => {
    test('redacts every key that could carry patient data', () => {
        const out = scrub({
            patientId: 'abc',
            name: 'Someone',
            phone: '+201000000000',
            email: 'a@b.c',
            notes: 'private',
            amount: 30000,
            chargedTotal: 30000,
            count: 3,
        });

        expect(out.patientId).toBe('abc');
        expect(out.count).toBe(3);
        for (const key of ['name', 'phone', 'email', 'notes', 'amount', 'chargedTotal']) {
            expect(out[key]).toBe('[redacted]');
        }
    });
});

describe('formatAlert', () => {
    test('renders the code, the summary, and the context', () => {
        const text = formatAlert(
            { code: 'backup.failed', summary: 'Backup failed.' },
            { attempt: 2, destination: 'local' },
        );

        expect(text).toContain('backup.failed');
        expect(text).toContain('Backup failed.');
        expect(text).toContain('attempt=2');
        expect(text).toContain('destination=local');
    });

    test('omits the context line when there is none', () => {
        expect(formatAlert({ code: 'x', summary: 'y' }, {})).toBe('**x** — y');
    });
});

describe('createAlerter', () => {
    test('sends the first alert for a code', async () => {
        const r = recorder();
        const alerter = createAlerter({ send: r.send, now: clock().now });

        await alerter.report({ code: 'db.error', summary: 'Database unreachable.' });

        expect(r.sent.length).toBe(1);
        expect(r.sent[0]?.alert.code).toBe('db.error');
    });

    test('scrubs patient data out of the delivered text', async () => {
        const r = recorder();
        const alerter = createAlerter({ send: r.send, now: clock().now });

        await alerter.report({
            code: 'db.error',
            summary: 'Database unreachable.',
            context: { phone: '+201000000000', patientId: 'p1' },
        });

        expect(r.sent[0]?.text).not.toContain('+201000000000');
        expect(r.sent[0]?.text).toContain('[redacted]');
        expect(r.sent[0]?.text).toContain('patientId=p1');
    });

    test('deduplicates the same code inside the window', async () => {
        const r = recorder();
        const c = clock();
        const alerter = createAlerter({ send: r.send, now: c.now, dedupeWindowMs: 60_000 });

        await alerter.report({ code: 'db.error', summary: 'Database unreachable.' });
        c.advance(30_000);
        await alerter.report({ code: 'db.error', summary: 'Database unreachable.' });

        expect(r.sent.length).toBe(1);
    });

    test('sends again once the dedupe window has passed', async () => {
        const r = recorder();
        const c = clock();
        const alerter = createAlerter({ send: r.send, now: c.now, dedupeWindowMs: 60_000 });

        await alerter.report({ code: 'db.error', summary: 'Database unreachable.' });
        c.advance(60_001);
        await alerter.report({ code: 'db.error', summary: 'Database unreachable.' });

        expect(r.sent.length).toBe(2);
    });

    test('does not deduplicate distinct codes', async () => {
        const r = recorder();
        const alerter = createAlerter({ send: r.send, now: clock().now });

        await alerter.report({ code: 'db.error', summary: 'a' });
        await alerter.report({ code: 'backup.failed', summary: 'b' });

        expect(r.sent.length).toBe(2);
    });

    test('rate-limits distinct codes and announces the ceiling once', async () => {
        const r = recorder();
        const c = clock();
        const alerter = createAlerter({
            send: r.send,
            now: c.now,
            dedupeWindowMs: 0,
            rateLimit: { max: 3, windowMs: 60_000 },
        });

        for (let i = 0; i < 6; i += 1) {
            await alerter.report({ code: `code.${i}`, summary: 'boom' });
        }

        expect(r.sent.length).toBe(4);
        expect(r.sent.at(-1)?.alert.code).toBe('monitoring.rate_limited');
    });

    test('resumes sending once the rate-limit window rolls over', async () => {
        const r = recorder();
        const c = clock();
        const alerter = createAlerter({
            send: r.send,
            now: c.now,
            dedupeWindowMs: 0,
            rateLimit: { max: 2, windowMs: 60_000 },
        });

        await alerter.report({ code: 'a', summary: 'x' });
        await alerter.report({ code: 'b', summary: 'x' });
        await alerter.report({ code: 'c', summary: 'x' });
        const suppressed = r.sent.length;

        c.advance(60_001);
        await alerter.report({ code: 'd', summary: 'x' });

        expect(r.sent.length).toBe(suppressed + 1);
        expect(r.sent.at(-1)?.alert.code).toBe('d');
    });

    test('swallows a failing transport — alerting never breaks the caller', async () => {
        const alerter = createAlerter({
            send: async () => {
                throw new Error('webhook down');
            },
            now: clock().now,
        });

        await expect(alerter.report({ code: 'db.error', summary: 'x' })).resolves.toBeUndefined();
    });
});

describe('discordSender', () => {
    test('posts the text as webhook content', async () => {
        let body: unknown;
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                body = await req.json();
                return new Response(null, { status: 204 });
            },
        });

        try {
            await discordSender(`http://localhost:${server.port}/hook`)(
                { code: 'db.error', summary: 'x' },
                'hello',
            );
            expect(body).toEqual({ content: 'hello' });
        } finally {
            server.stop(true);
        }
    });

    test('throws when the webhook rejects the post', async () => {
        const server = Bun.serve({ port: 0, fetch: () => new Response('no', { status: 400 }) });

        try {
            const send = discordSender(`http://localhost:${server.port}/hook`);
            await expect(send({ code: 'db.error', summary: 'x' }, 'hello')).rejects.toThrow('400');
        } finally {
            server.stop(true);
        }
    });
});

describe('heartbeat', () => {
    test('pings immediately on start and reports success', async () => {
        let hits = 0;
        const beat = startHeartbeat({
            url: 'http://monitor.invalid/beat',
            intervalMs: 60_000,
            fetchImpl: async () => {
                hits += 1;
                return new Response(null, { status: 200 });
            },
        });

        try {
            expect(await beat.ping()).toBe(true);
            expect(hits).toBeGreaterThanOrEqual(1);
        } finally {
            beat.stop();
        }
    });

    test('reports failure instead of throwing when the monitor is unreachable', async () => {
        const beat = startHeartbeat({
            url: 'http://monitor.invalid/beat',
            intervalMs: 60_000,
            fetchImpl: async () => {
                throw new Error('network down');
            },
        });

        try {
            expect(await beat.ping()).toBe(false);
        } finally {
            beat.stop();
        }
    });

    test('reports failure on a non-2xx response', async () => {
        const beat = startHeartbeat({
            url: 'http://monitor.invalid/beat',
            intervalMs: 60_000,
            fetchImpl: async () => new Response('nope', { status: 500 }),
        });

        try {
            expect(await beat.ping()).toBe(false);
        } finally {
            beat.stop();
        }
    });

    test('stays silent while the server is unhealthy', async () => {
        let hits = 0;
        const beat = startHeartbeat({
            url: 'http://monitor.invalid/beat',
            intervalMs: 60_000,
            isHealthy: async () => false,
            fetchImpl: async () => {
                hits += 1;
                return new Response(null, { status: 200 });
            },
        });

        try {
            expect(await beat.ping()).toBe(false);
            expect(hits).toBe(0);
        } finally {
            beat.stop();
        }
    });

    test('pings while the server is healthy', async () => {
        let hits = 0;
        const beat = startHeartbeat({
            url: 'http://monitor.invalid/beat',
            intervalMs: 60_000,
            isHealthy: async () => true,
            fetchImpl: async () => {
                hits += 1;
                return new Response(null, { status: 200 });
            },
        });

        try {
            expect(await beat.ping()).toBe(true);
            expect(hits).toBeGreaterThanOrEqual(1);
        } finally {
            beat.stop();
        }
    });
});
