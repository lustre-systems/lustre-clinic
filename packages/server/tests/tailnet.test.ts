import { describe, expect, test } from 'bun:test';
import { type Config, resolveServerEnvironment, resolveTailnetAddress } from '../src/config.ts';

function env(overrides: Partial<Config>): Config {
    return { PORT: 3000, ...overrides } as Config;
}

describe('resolveTailnetAddress', () => {
    test('prefers the MagicDNS name and gives it the port this process listens on', () => {
        expect(resolveTailnetAddress(env({ TAILSCALE_HOSTNAME: 'clinic-pc.tailnet.ts.net' }))).toBe(
            'http://clinic-pc.tailnet.ts.net:3000',
        );
    });

    test('keeps a port or scheme that was spelled out', () => {
        expect(resolveTailnetAddress(env({ TAILSCALE_HOSTNAME: 'clinic-pc.tailnet.ts.net:8080' }))).toBe(
            'http://clinic-pc.tailnet.ts.net:8080',
        );
        expect(resolveTailnetAddress(env({ TAILSCALE_HOSTNAME: 'https://clinic-pc.tailnet.ts.net' }))).toBe(
            'https://clinic-pc.tailnet.ts.net',
        );
    });

    test('falls back to the tailnet IP compose already needs', () => {
        expect(resolveTailnetAddress(env({ TAILSCALE_IP: '100.101.102.103' }))).toBe(
            'http://100.101.102.103:3000',
        );
    });

    test('refuses a bind address that is not a tailnet address', () => {
        expect(resolveTailnetAddress(env({ TAILSCALE_IP: '0.0.0.0' }))).toBeNull();
        expect(resolveTailnetAddress(env({ TAILSCALE_IP: '192.168.1.20' }))).toBeNull();
        expect(resolveTailnetAddress(env({ TAILSCALE_IP: '100.63.255.255' }))).toBeNull();
        expect(resolveTailnetAddress(env({ TAILSCALE_IP: '100.128.0.1' }))).toBeNull();
    });

    test('reports nothing when the clinic has not said, rather than guessing', () => {
        expect(resolveTailnetAddress(env({}))).toBeNull();
        expect(resolveTailnetAddress(env({ TAILSCALE_HOSTNAME: '   ' }))).toBeNull();
    });
});

describe('resolveServerEnvironment', () => {
    test('a built server is production unless the stack says otherwise', () => {
        expect(resolveServerEnvironment(env({ NODE_ENV: 'production' }))).toBe('production');
        expect(
            resolveServerEnvironment(env({ NODE_ENV: 'production', SERVER_ENVIRONMENT: 'development' })),
        ).toBe('development');
    });

    test('a server run from source is development', () => {
        expect(resolveServerEnvironment(env({ NODE_ENV: 'development' }))).toBe('development');
        expect(resolveServerEnvironment(env({ NODE_ENV: 'test' }))).toBe('development');
    });

    test('the stack saying production wins over a source run', () => {
        expect(
            resolveServerEnvironment(env({ NODE_ENV: 'development', SERVER_ENVIRONMENT: 'production' })),
        ).toBe('production');
    });
});
