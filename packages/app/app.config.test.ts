import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { UPDATES_CHANNEL, UPDATES_MANIFEST_PATH } from '@lustre/shared';
import type { ConfigContext } from 'expo/config';
import appConfig, {
    CHANNEL,
    DEV_CHANNEL,
    DEV_SERVER,
    devServer,
    glitchtipDsn,
    MANIFEST_PATH,
    releaseTrack,
    releaseVersion,
    updatesConfig,
} from './app.config';
import appJson from './app.json';
import {
    APPLICATION_ID_SUFFIX,
    applyDevApplicationId,
    applyDevReleaseBuildType,
    DEV_APP_NAME,
    DEV_RELEASE_STRINGS_PATH,
    DEV_STRINGS_PATH,
    DEV_STRINGS_XML,
} from './plugins/withDevIdentity';

/**
 * What a release APK is built to ask for, which cannot be changed after the
 * APK is on a phone. A demo that asks, or an APK that waits on the network at
 * launch, is a fix to the wrong app or a clinic stuck on the splash screen.
 */

describe('updatesConfig', () => {
    test('asks the path and channel the server answers', () => {
        expect(MANIFEST_PATH).toBe(UPDATES_MANIFEST_PATH);
        expect(CHANNEL).toBe(UPDATES_CHANNEL);
    });

    test('is off with no server to ask', () => {
        expect(updatesConfig(undefined, false)).toEqual({ enabled: false });
        expect(updatesConfig('  ', false)).toEqual({ enabled: false });
    });

    test('is off on a demo build, whatever server it was given', () => {
        expect(updatesConfig('http://clinic.tail.ts.net:3000', true)).toEqual({ enabled: false });
    });

    test('points a release build at the clinic server and never waits on it at launch', () => {
        expect(updatesConfig('http://clinic.tail.ts.net:3000/', false)).toMatchObject({
            enabled: true,
            url: 'http://clinic.tail.ts.net:3000/updates/manifest',
            fallbackToCacheTimeout: 0,
            requestHeaders: { 'expo-channel-name': 'production' },
            codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
        });
    });

    test('routes the installable dev build to the development update channel', () => {
        expect(updatesConfig('http://clinic.tail.ts.net:3001', false, 'development')).toMatchObject({
            enabled: true,
            url: 'http://clinic.tail.ts.net:3001/updates/manifest',
            requestHeaders: { 'expo-channel-name': DEV_CHANNEL },
        });
        expect(DEV_CHANNEL).not.toBe(CHANNEL);
    });

    test('verifies updates against a certificate that is in the repo', async () => {
        const certificate =
            updatesConfig('http://clinic.tail.ts.net:3000', false)?.codeSigningCertificate ?? '';
        const pem = await Bun.file(join(import.meta.dir, certificate)).text();
        expect(pem).toStartWith('-----BEGIN CERTIFICATE-----');
    });
});

describe('releaseVersion', () => {
    test('takes the number the release script passes in', () => {
        expect(releaseVersion(' 1.4.2 ', '0.0.0')).toBe('1.4.2');
    });

    test("falls back to app.json's placeholder outside a release", () => {
        expect(releaseVersion(undefined, '0.0.0')).toBe('0.0.0');
        expect(releaseVersion('', undefined)).toBe('0.0.0');
    });

    test('refuses a number that is not MAJOR.MINOR.PATCH', () => {
        expect(() => releaseVersion('1.4', '0.0.0')).toThrow('LUSTRE_VERSION');
        expect(() => releaseVersion('v1.4.2', '0.0.0')).toThrow('LUSTRE_VERSION');
    });
});

describe('releaseTrack', () => {
    test('defaults to production and rejects unknown tracks', () => {
        expect(releaseTrack(undefined)).toBe('production');
        expect(releaseTrack('development')).toBe('development');
        expect(() => releaseTrack('demo')).toThrow('LUSTRE_RELEASE_TRACK');
    });
});

describe('runtime fingerprint', () => {
    // A config that fails to load is replaced by an empty one without a word,
    // and every numbered release would then get a runtime of its own.
    test('skips the version fields, so a release number never changes the runtime', () => {
        const config = require('./fingerprint.config.js') as { sourceSkips: string[] };
        expect(config.sourceSkips).toContain('ExpoConfigVersions');
    });
});

describe('appConfig', () => {
    const context = (demo: boolean) =>
        ({
            config: { name: 'Lustre Clinic', slug: 'lustre-clinic', extra: { demo } },
            projectRoot: import.meta.dir,
            staticConfigPath: null,
            packageJsonPath: null,
        }) as ConfigContext;

    test('reads the server from LUSTRE_UPDATES_URL and the demo flag from app.json', () => {
        const previous = process.env.LUSTRE_UPDATES_URL;
        process.env.LUSTRE_UPDATES_URL = 'http://clinic.tail.ts.net:3000';

        expect(appConfig(context(false)).updates?.enabled).toBe(true);
        expect(appConfig(context(true)).updates?.enabled).toBe(false);

        if (previous === undefined) delete process.env.LUSTRE_UPDATES_URL;
        else process.env.LUSTRE_UPDATES_URL = previous;
    });

    test('bakes the GlitchTip DSN from LUSTRE_GLITCHTIP_DSN, and never into a demo', () => {
        const previous = process.env.LUSTRE_GLITCHTIP_DSN;
        const previousDevServer = process.env.LUSTRE_DEV_SERVER;
        const previousDrive = process.env.LUSTRE_DRIVE_CLIENT_ID;
        process.env.LUSTRE_GLITCHTIP_DSN = ' http://key@clinic.tail.ts.net:8000/1 ';
        delete process.env.LUSTRE_DEV_SERVER;
        delete process.env.LUSTRE_DRIVE_CLIENT_ID;

        expect(appConfig(context(false)).extra).toEqual({
            demo: false,
            devServer: DEV_SERVER,
            driveClientId: null,
            glitchtipDsn: 'http://key@clinic.tail.ts.net:8000/1',
        });
        expect(appConfig(context(true)).extra?.glitchtipDsn).toBeNull();

        if (previous === undefined) delete process.env.LUSTRE_GLITCHTIP_DSN;
        else process.env.LUSTRE_GLITCHTIP_DSN = previous;
        if (previousDevServer !== undefined) process.env.LUSTRE_DEV_SERVER = previousDevServer;
        if (previousDrive !== undefined) process.env.LUSTRE_DRIVE_CLIENT_ID = previousDrive;
    });

    test('bakes the Google client from LUSTRE_DRIVE_CLIENT_ID, trimmed', () => {
        const previous = process.env.LUSTRE_DRIVE_CLIENT_ID;
        process.env.LUSTRE_DRIVE_CLIENT_ID = ' 1-abc.apps.googleusercontent.com ';

        expect(appConfig(context(false)).extra?.driveClientId).toBe('1-abc.apps.googleusercontent.com');

        if (previous === undefined) delete process.env.LUSTRE_DRIVE_CLIENT_ID;
        else process.env.LUSTRE_DRIVE_CLIENT_ID = previous;
    });

    test('bakes the dev server the device scripts pass in, into every build', () => {
        const previous = process.env.LUSTRE_DEV_SERVER;
        process.env.LUSTRE_DEV_SERVER = 'http://localhost:3001/';

        // Every build, because only a dev one reads it (`api/config.ts`): a
        // value left out of a demo would be a second thing to get wrong.
        expect(appConfig(context(false)).extra?.devServer).toBe('http://localhost:3001');
        expect(appConfig(context(true)).extra?.devServer).toBe('http://localhost:3001');

        if (previous === undefined) delete process.env.LUSTRE_DEV_SERVER;
        else process.env.LUSTRE_DEV_SERVER = previous;
    });

    test('points an OTA dev build at the dev stack and disables clinic crash reporting', () => {
        const previousTrack = process.env.LUSTRE_RELEASE_TRACK;
        const previousUrl = process.env.LUSTRE_UPDATES_URL;
        process.env.LUSTRE_RELEASE_TRACK = 'development';
        process.env.LUSTRE_UPDATES_URL = 'http://clinic.tail.ts.net:3001';
        const config = appConfig(context(false));
        expect(config.name).toBe('Lustre DEV');
        expect(config.extra?.server).toEqual({ lan: null, tailscale: 'http://clinic.tail.ts.net:3001' });
        expect(config.extra?.devServer).toBeNull();
        expect(config.extra?.glitchtipDsn).toBeNull();
        expect(config.updates?.requestHeaders).toEqual({ 'expo-channel-name': 'development' });
        if (previousTrack === undefined) delete process.env.LUSTRE_RELEASE_TRACK;
        else process.env.LUSTRE_RELEASE_TRACK = previousTrack;
        if (previousUrl === undefined) delete process.env.LUSTRE_UPDATES_URL;
        else process.env.LUSTRE_UPDATES_URL = previousUrl;
    });
});

describe('glitchtipDsn', () => {
    test('is empty, and reports off, when nothing was given', () => {
        expect(glitchtipDsn(undefined, false)).toBeNull();
        expect(glitchtipDsn('   ', false)).toBeNull();
    });
});

/**
 * The other half of telling the two builds apart: a dev build has to install
 * beside the clinic's release rather than over it, and has to arrive pointing
 * at the dev server. Android refuses the second install of one package signed
 * two ways — "package already exists" — and the way past it was uninstalling
 * whichever build you were comparing against.
 */

// What `expo prebuild` writes into android/app/build.gradle (SDK 57), trimmed
// to the blocks the plugin touches. `signingConfigs` is kept: its `debug` block
// sits above the build type of the same name.
const GRADLE_TEMPLATE = `apply plugin: "com.android.application"

android {
    namespace 'com.lustre.clinic'
    defaultConfig {
        applicationId 'com.lustre.clinic'
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('dev application id', () => {
    const gradle = applyDevApplicationId(GRADLE_TEMPLATE);
    const buildTypes = gradle.slice(gradle.indexOf('buildTypes {'));
    const debugBuildType = buildTypes.slice(0, buildTypes.indexOf('release {'));
    const releaseBuildType = buildTypes.slice(buildTypes.indexOf('release {'));

    test('installs a dev build under an id of its own', () => {
        expect(debugBuildType).toContain(`applicationIdSuffix '${APPLICATION_ID_SUFFIX}'`);
        expect(`${appJson.expo.android.package}${APPLICATION_ID_SUFFIX}`).toBe('com.lustre.clinic.dev');
    });

    test("leaves a production build on the clinic's id, and its own name", () => {
        expect(appJson.expo.android.package).toBe('com.lustre.clinic');
        expect(appJson.expo.name).toBe('Lustre Clinic');
        expect(releaseBuildType).not.toContain('applicationIdSuffix');
        // The signing config above `buildTypes` is a `debug` block too, and
        // suffixing the wrong one would rename nothing and break the build.
        expect(gradle.slice(0, gradle.indexOf('buildTypes {'))).not.toContain('applicationIdSuffix');
    });

    test('names the dev build apart in the launcher, from the debug source set', () => {
        expect(DEV_STRINGS_XML).toContain(`<string name="app_name">${DEV_APP_NAME}</string>`);
        // Not merely different: a launcher truncates, so a name that opens with
        // the real one's reads as the real one in the drawer.
        expect(DEV_APP_NAME.startsWith(appJson.expo.name)).toBe(false);
        expect(DEV_APP_NAME).not.toBe(appJson.expo.name);
        // `main` is where prebuild writes app_name; a build type overrides it,
        // and any other source set would collide with it instead.
        expect(DEV_STRINGS_PATH.split(/[\\/]/)).toEqual([
            'app',
            'src',
            'debug',
            'res',
            'values',
            'strings.xml',
        ]);
    });

    test('is applied by a plugin, so prebuild cannot regenerate it away', () => {
        expect(appJson.expo.plugins).toContain('./plugins/withDevIdentity');
    });

    test('is written once, however many times prebuild runs', () => {
        expect(applyDevApplicationId(gradle)).toBe(gradle);
    });

    test('builds OTA dev as a release bundle under the existing dev package and key', () => {
        const withDevRelease = applyDevReleaseBuildType(gradle);
        expect(withDevRelease).toContain('devRelease {');
        expect(withDevRelease).toContain('initWith release');
        expect(withDevRelease).toContain(`applicationIdSuffix '${APPLICATION_ID_SUFFIX}'`);
        expect(withDevRelease).toContain('signingConfig signingConfigs.debug');
        expect(applyDevReleaseBuildType(withDevRelease)).toBe(withDevRelease);
        expect(DEV_RELEASE_STRINGS_PATH.split(/[\\\\/]/)).toEqual([
            'app',
            'src',
            'devRelease',
            'res',
            'values',
            'strings.xml',
        ]);
    });

    test('refuses to go quiet when the prebuild template moves', () => {
        expect(() => applyDevApplicationId('android {\n}\n')).toThrow('withDevIdentity');
    });
});

describe('devServer', () => {
    test('takes the address the device scripts reversed onto the phone', () => {
        expect(devServer(' http://localhost:8788/ ')).toBe('http://localhost:8788');
    });

    test('falls back to the port the server binds by default', () => {
        expect(devServer(undefined)).toBe(DEV_SERVER);
        expect(devServer('   ')).toBe(DEV_SERVER);
    });
});
