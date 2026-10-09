import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { APK_PATH, UPDATES_ASSETS_PATH, UPDATES_MANIFEST_PATH } from '@lustre/shared';
import { config } from '../src/config.ts';
import { startTestServer, type TestServer } from './helpers/trpc.ts';

/**
 * The releases a phone can reach (§15): the APK Settings offers, and the
 * expo-updates manifest a release build asks for on every launch. A wrong
 * answer is an install prompt that never goes away, or a fleet that never hears
 * about a fix, so the no-update paths are pinned as closely as the update.
 */

const RUNTIME = '3f1c0de4a9b2';
const UPDATE_ID = '0f6e2b8a-6a8e-4d49-9a0a-6f3b8b8e0d11';
const SIGNATURE = 'sig="c2lnbmVk", keyid="main"';

let server: TestServer;
let dir: string;
let previousDir: string;
let previousChannel: 'production' | 'development';

async function put(path: string, contents: string): Promise<void> {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), contents);
}

const APK_BYTES = 'PK-not-really-an-apk';

async function publishApk(versionCode = 525_600): Promise<void> {
    await put(
        'android/latest.json',
        JSON.stringify({ versionCode, version: '1.0.0', runtimeVersion: RUNTIME, size: APK_BYTES.length }),
    );
    await put('android/lustre.apk', APK_BYTES);
}

const UPDATE_DIR = `updates/${RUNTIME}/${UPDATE_ID}`;
const ASSET_BASE = `http://clinic.tail.ts.net:3000${UPDATES_ASSETS_PATH}/${RUNTIME}/${UPDATE_ID}`;
const BUNDLE = '_expo/static/js/android/index-1a2b.hbc';
const FONT = 'assets/5d41402abc4b2a76b9719d911017c592';

const MANIFEST = JSON.stringify({
    id: UPDATE_ID,
    runtimeVersion: RUNTIME,
    launchAsset: { url: `${ASSET_BASE}/${BUNDLE}` },
    assets: [{ url: `${ASSET_BASE}/${FONT}` }],
});

async function publishUpdate(): Promise<void> {
    await put(`${UPDATE_DIR}/manifest.json`, MANIFEST);
    await put(`${UPDATE_DIR}/signature`, `${SIGNATURE}\n`);
    await put(`${UPDATE_DIR}/${BUNDLE}`, 'bundle bytes');
    await put(`${UPDATE_DIR}/${FONT}`, 'font bytes');
    await put(`updates/${RUNTIME}/latest.json`, JSON.stringify({ id: UPDATE_ID }));
}

function askForUpdate(headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${server.baseUrl}${UPDATES_MANIFEST_PATH}`, {
        headers: {
            'expo-protocol-version': '1',
            'expo-platform': 'android',
            'expo-runtime-version': RUNTIME,
            'expo-channel-name': 'production',
            ...headers,
        },
    });
}

beforeAll(() => {
    previousDir = config.RELEASES_DIR;
    previousChannel = config.UPDATES_CHANNEL;
    server = startTestServer();
});

afterAll(() => {
    server.stop();
    config.RELEASES_DIR = previousDir;
    config.UPDATES_CHANNEL = previousChannel;
});

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lustre-releases-'));
    config.RELEASES_DIR = dir;
    config.UPDATES_CHANNEL = 'production';
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('release.latestApk', () => {
    test('is null before anything is published', async () => {
        expect(await server.client.release.latestApk.query()).toBeNull();
    });

    test('reports the version and build of the staged APK', async () => {
        await publishApk();
        expect(await server.client.release.latestApk.query()).toEqual({
            versionCode: 525_600,
            version: '1.0.0',
            runtimeVersion: RUNTIME,
        });
    });

    test('is null when the metadata has no APK beside it, or is not readable', async () => {
        await put('android/latest.json', JSON.stringify({ versionCode: 2, version: '1.0.0' }));
        expect(await server.client.release.latestApk.query()).toBeNull();

        await put('android/lustre.apk', 'PK');
        await put('android/latest.json', '{ not json');
        expect(await server.client.release.latestApk.query()).toBeNull();
    });

    test('is null while the APK beside the metadata is not the one it describes', async () => {
        await publishApk();
        // A copy that has landed the new metadata but not yet the new APK.
        await put('android/lustre.apk', 'PK-the-previous-apk-which-is-longer');
        expect(await server.client.release.latestApk.query()).toBeNull();
    });
});

describe(APK_PATH, () => {
    test('is a 404 before anything is published', async () => {
        const res = await fetch(`${server.baseUrl}${APK_PATH}`);
        expect(res.status).toBe(404);
    });

    test('downloads as an APK Android offers to install', async () => {
        await publishApk();
        const res = await fetch(`${server.baseUrl}${APK_PATH}`);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="lustre-1.0.0-525600.apk"');
        expect(await res.text()).toBe('PK-not-really-an-apk');
    });
});

describe(UPDATES_MANIFEST_PATH, () => {
    test('serves the published manifest verbatim, with its signature', async () => {
        await publishUpdate();
        const res = await askForUpdate();

        expect(res.status).toBe(200);
        expect(res.headers.get('expo-protocol-version')).toBe('1');
        expect(res.headers.get('expo-signature')).toBe(SIGNATURE);
        expect(await res.text()).toBe(MANIFEST);
    });

    test('says "no update" in the form the client accepts: a 204 with the protocol header', async () => {
        const res = await askForUpdate();
        expect(res.status).toBe(204);
        expect(res.headers.get('expo-protocol-version')).toBe('1');
    });

    test('has nothing for another runtime, another channel, or a phone already on it', async () => {
        await publishUpdate();

        expect((await askForUpdate({ 'expo-runtime-version': 'an-older-apk' })).status).toBe(204);
        expect((await askForUpdate({ 'expo-channel-name': 'demo' })).status).toBe(204);
        expect((await askForUpdate({ 'expo-current-update-id': UPDATE_ID })).status).toBe(204);
    });

    test('the dev stack serves only the development channel', async () => {
        await publishUpdate();
        config.UPDATES_CHANNEL = 'development';
        expect((await askForUpdate()).status).toBe(204);
        expect((await askForUpdate({ 'expo-channel-name': 'development' })).status).toBe(200);
    });

    test('refuses a request that is not expo-updates protocol 1 from Android', async () => {
        await publishUpdate();

        expect((await askForUpdate({ 'expo-protocol-version': '0' })).status).toBe(400);
        expect((await askForUpdate({ 'expo-platform': 'ios' })).status).toBe(400);
        expect((await fetch(`${server.baseUrl}${UPDATES_MANIFEST_PATH}`)).status).toBe(400);
    });

    test('does not read a runtime version as a path', async () => {
        await publishUpdate();
        expect((await askForUpdate({ 'expo-runtime-version': '..' })).status).toBe(204);
    });

    test('serves the latest update on an APK staged releases ago', async () => {
        // An OTA ship leaves the APK alone, so a fresh install of 1.0.0 asks for, and gets, the 1.0.3 update.
        await publishApk();
        await publishUpdate();
        await put(
            `${UPDATE_DIR}/manifest.json`,
            JSON.stringify({ ...JSON.parse(MANIFEST), metadata: { version: '1.0.3' } }),
        );

        expect((await server.client.release.latestApk.query())?.version).toBe('1.0.0');
        const res = await askForUpdate({ 'expo-current-update-id': 'the-bundle-inside-the-apk' });
        expect(res.status).toBe(200);
        expect(JSON.parse(await res.text()).metadata.version).toBe('1.0.3');
    });

    test('offers nothing until every file the manifest names has arrived', async () => {
        await publishUpdate();
        await rm(join(dir, UPDATE_DIR, FONT));
        expect((await askForUpdate()).status).toBe(204);
    });

    test('offers nothing without a signature, since release builds refuse an unsigned manifest', async () => {
        await publishUpdate();
        await put(`${UPDATE_DIR}/signature`, '  \n');
        expect((await askForUpdate()).status).toBe(204);

        await rm(join(dir, UPDATE_DIR, 'signature'));
        expect((await askForUpdate()).status).toBe(204);
    });
});

describe(UPDATES_ASSETS_PATH, () => {
    test('serves a file of a published update', async () => {
        await publishUpdate();
        const res = await fetch(
            `${server.baseUrl}${UPDATES_ASSETS_PATH}/${RUNTIME}/${UPDATE_ID}/_expo/static/js/android/index-1a2b.hbc`,
        );

        expect(res.status).toBe(200);
        expect(await res.text()).toBe('bundle bytes');
    });

    test('serves nothing outside an update directory', async () => {
        await publishUpdate();
        await put('android/lustre.apk', 'PK');

        const paths = [
            `${RUNTIME}/latest.json`,
            `${RUNTIME}/${UPDATE_ID}/%2e%2e/%2e%2e/android/lustre.apk`,
            `${RUNTIME}/${UPDATE_ID}/missing.hbc`,
        ];
        for (const path of paths) {
            expect((await fetch(`${server.baseUrl}${UPDATES_ASSETS_PATH}/${path}`)).status).toBe(404);
        }
    });
});
