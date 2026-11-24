import { describe, expect, test } from 'bun:test';
import {
    formatVersion,
    nextApkVersion,
    nextUpdateVersion,
    parseVersion,
    tagFor,
    type Version,
} from './releaseVersion';

const v = (text: string): Version => {
    const parsed = parseVersion(text);
    if (!parsed) throw new Error(`not a version: ${text}`);
    return parsed;
};

describe('parseVersion', () => {
    test('reads a version with or without the tag prefix', () => {
        expect(parseVersion('1.4.2')).toEqual({ major: 1, minor: 4, patch: 2 });
        expect(parseVersion('v10.0.13')).toEqual({ major: 10, minor: 0, patch: 13 });
    });

    test('refuses anything that is not three plain numbers', () => {
        for (const text of ['', '1.4', '1.4.2.1', '01.4.2', '1.4.2-beta', 'vx.y.z', 'release-1']) {
            expect(parseVersion(text)).toBeNull();
        }
    });

    test('formats and tags round-trip', () => {
        expect(formatVersion(v('1.4.2'))).toBe('1.4.2');
        expect(tagFor(v('1.4.2'))).toBe('v1.4.2');
    });
});

describe('nextApkVersion', () => {
    test('starts at 1.0.0', () => {
        expect(formatVersion(nextApkVersion([]))).toBe('1.0.0');
        expect(formatVersion(nextApkVersion([null, undefined, 'not-a-tag']))).toBe('1.0.0');
    });

    test('is one minor above the highest release, update or APK', () => {
        expect(formatVersion(nextApkVersion(['v1.0.0', 'v1.0.3', 'v1.1.0', 'v1.1.2']))).toBe('1.2.0');
    });

    test('compares numbers, not strings', () => {
        expect(formatVersion(nextApkVersion(['v1.9.0', 'v1.10.0', 'v1.2.0']))).toBe('1.11.0');
    });

    test('takes the staged APK into account when there are no tags', () => {
        expect(formatVersion(nextApkVersion(['1.0.0']))).toBe('1.1.0');
    });

    test('starts a new major line on request', () => {
        expect(formatVersion(nextApkVersion(['v1.4.2'], true))).toBe('2.0.0');
        expect(formatVersion(nextApkVersion([], true))).toBe('1.0.0');
    });
});

describe('nextUpdateVersion', () => {
    test('the first update on an APK is patch 1', () => {
        expect(formatVersion(nextUpdateVersion(v('1.4.0'), []))).toBe('1.4.1');
        expect(formatVersion(nextUpdateVersion(v('1.4.0'), ['v1.4.0']))).toBe('1.4.1');
    });

    test('counts on from the highest update on the same line', () => {
        expect(formatVersion(nextUpdateVersion(v('1.4.0'), ['v1.4.1', '1.4.3', 'v1.4.2']))).toBe('1.4.4');
    });

    test('ignores what came before the APK, and other majors', () => {
        expect(formatVersion(nextUpdateVersion(v('1.4.0'), ['v1.3.9', 'v2.4.7']))).toBe('1.4.1');
    });

    test('counts on from an update that moved the minor', () => {
        expect(formatVersion(nextUpdateVersion(v('1.5.0'), ['v1.5.1', 'v1.6.0']))).toBe('1.6.1');
    });

    test('a minor update is one minor above everything since the APK, at patch 0', () => {
        expect(formatVersion(nextUpdateVersion(v('1.5.0'), ['v1.5.1', 'v1.5.2'], true))).toBe('1.6.0');
        expect(formatVersion(nextUpdateVersion(v('1.5.0'), ['v1.6.0', 'v1.6.3'], true))).toBe('1.7.0');
    });

    test('an update published before versioning does not count', () => {
        expect(formatVersion(nextUpdateVersion(v('1.0.0'), [null, undefined]))).toBe('1.0.1');
    });
});
