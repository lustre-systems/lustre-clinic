import { describe, expect, test } from 'bun:test';
import { apkLabel, type InstalledVersion, newerApk, updateLabel, versionLine } from './appVersion';

const plain = (text: string) => text.replace(/[\u2068\u2069]/g, '');

const latest = { versionCode: 525_600, version: '1.1.0', runtimeVersion: 'a1b2c3' };

describe('newerApk', () => {
    test('offers a higher build', () => {
        expect(newerApk('525599', latest)).toEqual(latest);
        expect(newerApk('1', latest)).toEqual(latest);
    });

    test('offers nothing to a phone on that build or a later one', () => {
        expect(newerApk('525600', latest)).toBeNull();
        expect(newerApk('525601', latest)).toBeNull();
    });

    test('compares numbers, not strings', () => {
        expect(
            newerApk('99999', { versionCode: 100_000, version: '1.1.0', runtimeVersion: null }),
        ).not.toBeNull();
        expect(
            newerApk('100000', { versionCode: 99_999, version: '1.0.0', runtimeVersion: null }),
        ).toBeNull();
    });

    test('offers nothing on the runtime the phone runs: its updates already brought that code', () => {
        expect(newerApk('1', latest, 'a1b2c3')).toBeNull();
    });

    test('offers a higher build with other native code', () => {
        expect(newerApk('1', latest, 'f00d')).toEqual(latest);
    });

    test('goes by the build alone when either side cannot say its runtime', () => {
        expect(newerApk('1', latest, null)).toEqual(latest);
        const unsaid = { ...latest, runtimeVersion: null };
        expect(newerApk('1', unsaid, 'a1b2c3')).toEqual(unsaid);
    });

    test('offers nothing when the server has no APK or the server did not answer', () => {
        expect(newerApk('1', null)).toBeNull();
        expect(newerApk('1', undefined)).toBeNull();
    });

    test('offers nothing to an install that cannot say its own build', () => {
        for (const build of [null, '', 'abc', '0', '-3', '1.5']) {
            expect(newerApk(build, latest)).toBeNull();
        }
    });
});

const installed: InstalledVersion = {
    version: '1.0.2',
    apkVersion: '1.0.0',
    build: '525600',
    updateId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    updateCreatedAt: new Date('2026-09-14T10:00:00Z'),
    embedded: false,
};

describe('versionLine', () => {
    test('names the release the phone runs, update included, and the build', () => {
        expect(versionLine(installed)).toBe('Lustre 1.0.2 (build 525600)');
        expect(versionLine({ version: '1.0.2', build: null })).toBe('Lustre 1.0.2');
    });
});

describe('apkLabel', () => {
    test('names the APK under the update', () => {
        expect(apkLabel(installed)).toBe('1.0.0 · build 525600');
        expect(apkLabel({ apkVersion: '1.0.0', build: null })).toBe('1.0.0');
        expect(apkLabel({ apkVersion: null, build: null })).toBe('—');
    });
});

describe('updateLabel', () => {
    test('names a downloaded update by its short id and day', () => {
        expect(updateLabel(installed)).toBe('7c9e6679 · 2026-09-14');
    });

    test('says when the APK runs its own bundle, or cannot take updates at all', () => {
        expect(updateLabel({ ...installed, embedded: true })).toBe('Built in');
        expect(updateLabel({ ...installed, updateId: null })).toBe('Off in this build');
    });
});

describe('in Arabic', () => {
    test('every label is in Arabic, with the version figures left in Latin digits', () => {
        expect(plain(versionLine(installed, 'ar'))).toBe('لستر 1.0.2 (البنية 525600)');
        expect(plain(apkLabel(installed, 'ar'))).toBe('1.0.0 · البنية 525600');
        expect(updateLabel({ ...installed, embedded: true }, 'ar')).toBe('مدمج');
        expect(updateLabel({ ...installed, updateId: null }, 'ar')).toBe('غير متاح في هذه النسخة');
    });
});
