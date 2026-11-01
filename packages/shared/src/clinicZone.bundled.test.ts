/**
 * The table bundled into the app is what one-phone mode and a phone that has
 * never reached a server convert every time with. It goes stale two ways: the
 * zone's rules change (Bun's ICU says so), or it runs out. Either fails here;
 * `bun packages/shared/scripts/bundle-clinic-zone.ts` writes a fresh one, and
 * an OTA update carries it.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { render } from '../scripts/bundle-clinic-zone.ts';
import { BUNDLED_CLINIC_ZONE_UNTIL } from './clinicZone.bundled.ts';

const YEAR = 365 * 24 * 3_600_000;

describe('the bundled clinic zone', () => {
    it("agrees with this machine's zone data", async () => {
        const file = await Bun.file(path.join(import.meta.dir, 'clinicZone.bundled.ts')).text();
        expect(file).toBe(render(BUNDLED_CLINIC_ZONE_UNTIL));
    });

    it('runs at least a year past today', () => {
        expect(BUNDLED_CLINIC_ZONE_UNTIL).toBeGreaterThan(Date.now() + YEAR);
    });
});
