import { describe, expect, it } from 'bun:test';
import {
    acceptsServer,
    allowsDemo,
    allowsLan,
    bootAddresses,
    isTailnetAddress,
    showsDevBanner,
    usableAddresses,
    variantOf,
} from './variant';

describe('variantOf', () => {
    it('calls a release build with no shipped demo prod', () => {
        expect(variantOf({ dev: false, shippedDemo: false })).toBe('prod');
    });

    it('keeps a release build that ships the demo out of prod', () => {
        expect(variantOf({ dev: false, shippedDemo: true })).toBe('demo');
    });

    it('lets `__DEV__` win over a shipped demo flag', () => {
        expect(variantOf({ dev: true, shippedDemo: false })).toBe('dev');
        expect(variantOf({ dev: true, shippedDemo: true })).toBe('dev');
    });

    it('keeps the release-bundled dev app on the dev rules using its native package id', () => {
        expect(variantOf({ dev: false, shippedDemo: false, applicationId: 'com.lustre.clinic.dev' })).toBe(
            'dev',
        );
        expect(variantOf({ dev: false, shippedDemo: false, applicationId: 'com.lustre.clinic' })).toBe(
            'prod',
        );
    });
});

describe('prod rules', () => {
    it('allows neither the LAN address nor demo mode', () => {
        expect(allowsLan('prod')).toBe(false);
        expect(allowsDemo('prod')).toBe(false);
    });

    it('keeps both for dev and demo builds', () => {
        for (const variant of ['dev', 'demo'] as const) {
            expect(allowsLan(variant)).toBe(true);
            expect(allowsDemo(variant)).toBe(true);
        }
    });

    it('drops a LAN address on prod, even one that is already set', () => {
        const saved = { lan: 'http://192.168.1.20:3000', tailscale: 'http://clinic.ts.net:3000' };
        expect(usableAddresses('prod', saved)).toEqual({ lan: null, tailscale: 'http://clinic.ts.net:3000' });
        expect(usableAddresses('dev', saved)).toEqual(saved);
    });

    it('drops a Tailscale address that is not on the tailnet, on prod only', () => {
        const wifi = { lan: null, tailscale: 'http://192.168.1.20:3000' };
        expect(usableAddresses('prod', wifi)).toEqual({ lan: null, tailscale: null });
        expect(usableAddresses('dev', wifi)).toEqual(wifi);
        expect(usableAddresses('demo', wifi)).toEqual(wifi);
    });
});

describe('showsDevBanner', () => {
    it('marks a dev build and nothing that ships', () => {
        expect(showsDevBanner('dev')).toBe(true);
        expect(showsDevBanner('prod')).toBe(false);
        expect(showsDevBanner('demo')).toBe(false);
    });

    it('follows the build rather than a flag anyone maintains', () => {
        expect(showsDevBanner(variantOf({ dev: true, shippedDemo: true }))).toBe(true);
        expect(showsDevBanner(variantOf({ dev: false, shippedDemo: false }))).toBe(false);
    });
});

describe('acceptsServer', () => {
    it('keeps a dev build off any server but the dev one', () => {
        expect(acceptsServer('dev', 'development')).toBe(true);
        expect(acceptsServer('dev', 'production')).toBe(false);
    });

    it('refuses a server that does not say which it is', () => {
        expect(acceptsServer('dev', undefined)).toBe(false);
        expect(acceptsServer('dev', null)).toBe(false);
    });

    it('leaves the clinic and demo builds to the server they were given', () => {
        expect(acceptsServer('prod', 'production')).toBe(true);
        expect(acceptsServer('prod', undefined)).toBe(true);
        expect(acceptsServer('demo', 'development')).toBe(true);
    });
});

describe('bootAddresses', () => {
    const none = { lan: null, tailscale: null };
    const DEV_SERVER = 'http://localhost:3000';

    it('points a dev build at the dev server when nothing was configured', () => {
        expect(bootAddresses('dev', none, DEV_SERVER)).toEqual({ lan: DEV_SERVER, tailscale: null });
    });

    it('never gives one to a shipped build, which asks setup instead', () => {
        expect(bootAddresses('prod', none, DEV_SERVER)).toEqual(none);
        expect(bootAddresses('demo', none, DEV_SERVER)).toEqual(none);
    });

    it('leaves a configured LAN address alone', () => {
        const configured = { lan: 'http://192.168.1.20:3000', tailscale: null };
        expect(bootAddresses('dev', configured, DEV_SERVER)).toEqual(configured);
    });

    it('still fills the LAN side of a build configured with a tailnet address only', () => {
        const tailnet = { lan: null, tailscale: 'http://clinic.ts.net:3000' };
        expect(bootAddresses('dev', tailnet, DEV_SERVER)).toEqual({ ...tailnet, lan: DEV_SERVER });
    });
});

describe('isTailnetAddress', () => {
    it('accepts a MagicDNS name however it was typed', () => {
        expect(isTailnetAddress('http://smilemakers.tailad17f9.ts.net:3000')).toBe(true);
        expect(isTailnetAddress('smilemakers.tailad17f9.ts.net:3000')).toBe(true);
        expect(isTailnetAddress('HTTP://SMILEMAKERS.TAILAD17F9.TS.NET:3000/')).toBe(true);
    });

    it("accepts Tailscale's IPv4 range and nothing either side of it", () => {
        expect(isTailnetAddress('http://100.125.78.21:3000')).toBe(true);
        expect(isTailnetAddress('100.64.0.1')).toBe(true);
        expect(isTailnetAddress('100.127.255.255')).toBe(true);
        expect(isTailnetAddress('http://100.63.255.255:3000')).toBe(false);
        expect(isTailnetAddress('http://100.128.0.1:3000')).toBe(false);
    });

    it("accepts Tailscale's IPv6 range", () => {
        expect(isTailnetAddress('http://[fd7a:115c:a1e0::53]:3000')).toBe(true);
        expect(isTailnetAddress('http://[fd00::1]:3000')).toBe(false);
    });

    it('refuses the wifi, the emulator host and short names', () => {
        expect(isTailnetAddress('http://192.168.1.20:3000')).toBe(false);
        expect(isTailnetAddress('http://localhost:3000')).toBe(false);
        expect(isTailnetAddress('http://10.0.2.2:3000')).toBe(false);
        expect(isTailnetAddress('http://clinic-pc:3000')).toBe(false);
        expect(isTailnetAddress('')).toBe(false);
    });

    it('reads the host, not a lookalike in the path or the userinfo', () => {
        expect(isTailnetAddress('http://ts.net.evil.example:3000')).toBe(false);
        expect(isTailnetAddress('http://evil.example/clinic.ts.net')).toBe(false);
        expect(isTailnetAddress('http://clinic.ts.net@evil.example:3000')).toBe(false);
    });
});
