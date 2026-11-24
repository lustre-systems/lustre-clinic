import { describe, expect, test } from 'bun:test';
import { applyReleaseVersionCode, EPOCH_MS, STEP_MS, versionCodeAt } from './withReleaseVersionCode';

describe('release versionCode', () => {
    test('counts from 2026-01-01 UTC', () => {
        expect(new Date(EPOCH_MS).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    test('gives two builds inside the same minute different, rising numbers', () => {
        const first = versionCodeAt(Date.UTC(2026, 8, 14, 9, 0, 5));
        const second = versionCodeAt(Date.UTC(2026, 8, 14, 9, 0, 45));
        expect(second).toBeGreaterThan(first);
    });

    test('moves on every step, which is shorter than any release build', () => {
        const at = Date.UTC(2026, 8, 14, 9, 0, 0);
        expect(versionCodeAt(at + STEP_MS)).toBe(versionCodeAt(at) + 1);
        expect(STEP_MS).toBeLessThanOrEqual(60_000);
    });

    test('numbers new builds above every build made under the old per-minute scheme', () => {
        expect(versionCodeAt(Date.UTC(2026, 8, 14, 13, 0))).toBeGreaterThan(369_409);
    });

    test("stays under Android's ceiling for six hundred years", () => {
        const sixHundredYears = 600 * 365.25 * 24 * 60 * 60 * 1000;
        expect(versionCodeAt(EPOCH_MS + sixHundredYears)).toBeLessThan(2_100_000_000);
    });
});

describe('applyReleaseVersionCode', () => {
    const gradle = applyReleaseVersionCode('android {\n}\n');

    test('stamps both installable builds, with the number the tests above describe', () => {
        expect(gradle).toContain("['release', 'devRelease'].each");
        expect(gradle).toContain('onVariants(selector().withBuildType(buildType))');
        expect(gradle).toContain(`(System.currentTimeMillis() - ${EPOCH_MS}L).intdiv(${STEP_MS}L)`);
    });

    test('changes nothing on a second prebuild', () => {
        expect(applyReleaseVersionCode(gradle)).toBe(gradle);
    });
});
