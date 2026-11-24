import { describe, expect, test } from 'bun:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { base64UrlSha256, manifestFor, signManifest } from './updateManifest';

const bytes = (text: string) => new TextEncoder().encode(text);

const ID = '0f6e2b8a-6a8e-4d49-9a0a-6f3b8b8e0d11';

const manifest = manifestFor({
    id: ID,
    createdAt: new Date('2026-09-14T10:00:00Z'),
    runtimeVersion: '3f1c0de4',
    version: '1.0.1',
    serverUrl: 'http://clinic.tail.ts.net:3000/',
    bundle: { path: '_expo/static/js/android/index-1a2b.hbc', ext: 'hbc', bytes: bytes('bundle') },
    assets: [{ path: 'assets/5d41402abc4b2a76b9719d911017c592', ext: 'png', bytes: bytes('hello') }],
    expoClient: { name: 'Lustre Clinic', version: '1.0.1' },
});

describe('manifestFor', () => {
    test('hashes the way the phone does: base64url SHA-256, unpadded', () => {
        expect(base64UrlSha256(bytes('hello'))).toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
    });

    test('points every file at the clinic server under its runtime and id', () => {
        expect(manifest.launchAsset.url).toBe(
            `http://clinic.tail.ts.net:3000/updates/assets/3f1c0de4/${ID}/_expo/static/js/android/index-1a2b.hbc`,
        );
        expect(manifest.assets[0]?.url).toBe(
            `http://clinic.tail.ts.net:3000/updates/assets/3f1c0de4/${ID}/assets/5d41402abc4b2a76b9719d911017c592`,
        );
    });

    test('keys every file by a bare filename the phone can store it under', () => {
        for (const asset of [manifest.launchAsset, ...manifest.assets]) {
            expect(asset.key).toMatch(/^[0-9a-f]{32}$/);
        }
        expect(manifest.assets[0]).toMatchObject({
            key: '5d41402abc4b2a76b9719d911017c592',
            contentType: 'image/png',
            fileExtension: '.png',
        });
    });

    test('carries the protocol fields and the config the app reads on this update', () => {
        expect(manifest).toMatchObject({
            id: ID,
            createdAt: '2026-09-14T10:00:00.000Z',
            runtimeVersion: '3f1c0de4',
            metadata: { version: '1.0.1' },
            extra: { expoClient: { name: 'Lustre Clinic', version: '1.0.1' } },
        });
    });

    test('marks a --screen patch, and leaves every other update unmarked', () => {
        expect(manifest.metadata).toEqual({ version: '1.0.1' });
        const screen = manifestFor({
            id: ID,
            createdAt: new Date('2026-09-14T10:00:00Z'),
            runtimeVersion: '3f1c0de4',
            version: '1.0.1',
            screen: true,
            serverUrl: 'http://clinic.tail.ts.net:3000/',
            bundle: { path: 'index.hbc', ext: 'hbc', bytes: bytes('bundle') },
            assets: [],
            expoClient: {},
        });
        expect(screen.metadata).toEqual({ version: '1.0.1', screen: 'true' });
    });
});

describe('signManifest', () => {
    test('signs the exact body with RSA-SHA256, in the header form the client parses', () => {
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const body = JSON.stringify(manifest);
        const header = signManifest(body, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

        const match = header.match(/^sig="([A-Za-z0-9+/=]+)", keyid="main"$/);
        expect(match).not.toBeNull();
        const signature = match?.[1] ?? '';

        expect(createVerify('RSA-SHA256').update(body).verify(publicKey, signature, 'base64')).toBe(true);
        expect(createVerify('RSA-SHA256').update(`${body} `).verify(publicKey, signature, 'base64')).toBe(
            false,
        );
    });
});
