import { describe, expect, test } from 'bun:test';
import { applyReleaseSigning, PROPERTIES } from './withReleaseSigning';

const TEMPLATE = `apply plugin: "com.android.application"

def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    namespace 'com.lustre.clinic'
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

const signed = applyReleaseSigning(TEMPLATE);
const buildTypes = signed.slice(signed.indexOf('buildTypes {'));
const debugBuildType = buildTypes.slice(0, buildTypes.indexOf('release {'));
const releaseBuildType = buildTypes.slice(buildTypes.indexOf('release {'));

describe('applyReleaseSigning', () => {
    test('signs release builds with the release config and leaves debug builds on the debug key', () => {
        expect(debugBuildType).toContain('signingConfig signingConfigs.debug');
        expect(releaseBuildType).toContain('signingConfig signingConfigs.release');
        expect(releaseBuildType).not.toContain('signingConfigs.debug');
    });

    test('reads every credential from a Gradle property and writes none into the file', () => {
        for (const name of PROPERTIES) expect(signed).toContain(`lustreSigning.${name}`);
        expect(signed.match(/storePassword '/g)).toHaveLength(1);
    });

    test('stops a release build that has no keystore instead of falling back', () => {
        expect(signed).toContain('throw new GradleException');
        expect(signed).toContain("it.name.contains('Release')");
    });

    test('defines the signing config before the android block uses it', () => {
        expect(signed.indexOf('def lustreSigning')).toBeLessThan(signed.indexOf('\nandroid {'));
        expect(signed.indexOf('        release {')).toBeLessThan(signed.indexOf('buildTypes {'));
    });

    test('changes nothing on a second prebuild', () => {
        expect(applyReleaseSigning(signed)).toBe(signed);
    });

    test('refuses a template it does not recognise rather than leaving the debug key in place', () => {
        expect(() => applyReleaseSigning('android {\n}\n')).toThrow(/prebuild template changed/);
    });
});
