import { describe, expect, test } from 'bun:test';
import { filesToSend, parseListing, pointerRank, reuseSources } from './releasePlan';

const UPDATE = 'updates/abc/0b2d6c1e-1111-4222-8333-444455556666';

describe('pointerRank', () => {
    test('orders update pointers, then the APK, then its metadata', () => {
        expect(pointerRank(`${UPDATE}/manifest.json`)).toBe(0);
        expect(pointerRank(`${UPDATE}/latest.json`)).toBe(0);
        expect(pointerRank('updates/abc/latest.json')).toBe(1);
        expect(pointerRank('android/lustre.apk')).toBe(2);
        expect(pointerRank('android/latest.json')).toBe(3);
    });
});

describe('filesToSend', () => {
    const local = [
        { path: 'android/latest.json', sha256: 'apk-meta-2' },
        { path: 'android/lustre.apk', sha256: 'apk-1' },
        { path: 'updates/abc/latest.json', sha256: 'pointer-2' },
        { path: `${UPDATE}/manifest.json` },
        { path: `${UPDATE}/signature` },
        { path: 'updates/abc/old/manifest.json' },
    ];

    test('sends what the server lacks, pointers by checksum and last', () => {
        const present = new Set([
            'android/latest.json',
            'android/lustre.apk',
            'updates/abc/latest.json',
            'updates/abc/old/manifest.json',
        ]);
        const sums = new Map([
            ['android/latest.json', 'apk-meta-1'],
            ['android/lustre.apk', 'apk-1'],
            ['updates/abc/latest.json', 'pointer-1'],
        ]);
        expect(filesToSend(local, present, sums)).toEqual([
            `${UPDATE}/manifest.json`,
            `${UPDATE}/signature`,
            'updates/abc/latest.json',
            'android/latest.json',
        ]);
    });

    test('an unchanged APK is not sent again', () => {
        const sums = new Map([['android/lustre.apk', 'apk-1']]);
        expect(filesToSend(local, new Set(['android/lustre.apk']), sums)).not.toContain('android/lustre.apk');
    });

    test('an empty server gets everything, pointers last', () => {
        const sent = filesToSend(local, new Set(), new Map());
        expect(sent).toHaveLength(local.length);
        expect(sent.slice(-3)).toEqual([
            'updates/abc/latest.json',
            'android/lustre.apk',
            'android/latest.json',
        ]);
    });
});

describe('parseListing', () => {
    test('reads files and pointer checksums', () => {
        const { present, sums } = parseListing(
            ['F android/lustre.apk', 'F updates/abc/latest.json', 'S 1234  android/lustre.apk', ''].join(
                '\n',
            ),
        );
        expect([...present]).toEqual(['android/lustre.apk', 'updates/abc/latest.json']);
        expect(sums.get('android/lustre.apk')).toBe('1234');
    });
});

describe('reuseSources', () => {
    const old = 'updates/abc/11111111-1111-4111-8111-111111111111';
    const onServer = [
        `${old}/assets/0123abcd`,
        `${old}/assets/ffff0000`,
        `${old}/_expo/static/js/android/index-aaa.hbc`,
        `${old}/manifest.json`,
        'updates/def/22222222-2222-4222-8222-222222222222/_expo/static/js/android/index-bbb.hbc',
        'android/lustre.apk',
    ];

    test('an asset comes from the same asset in an earlier update', () => {
        expect(reuseSources(`${UPDATE}/assets/0123abcd`, onServer)).toEqual([`${old}/assets/0123abcd`]);
        expect(reuseSources(`${UPDATE}/assets/99999999`, onServer)).toEqual([]);
    });

    test('a bundle may be a delta on any earlier bundle', () => {
        expect(reuseSources(`${UPDATE}/_expo/static/js/android/index-ccc.hbc`, onServer)).toEqual([
            `${old}/_expo/static/js/android/index-aaa.hbc`,
            'updates/def/22222222-2222-4222-8222-222222222222/_expo/static/js/android/index-bbb.hbc',
        ]);
    });

    test('manifests, signatures, pointers and the APK always go whole', () => {
        expect(reuseSources(`${UPDATE}/manifest.json`, onServer)).toEqual([]);
        expect(reuseSources(`${UPDATE}/signature`, onServer)).toEqual([]);
        expect(reuseSources('updates/abc/latest.json', onServer)).toEqual([]);
        expect(reuseSources('android/lustre.apk', onServer)).toEqual([]);
    });

    test('never from its own update', () => {
        expect(reuseSources(`${old}/assets/0123abcd`, onServer)).toEqual([]);
    });
});
