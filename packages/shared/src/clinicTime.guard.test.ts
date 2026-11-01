/**
 * Nothing in the app or in shared reads or sets a time in the phone's zone.
 *
 * Every one of these calls answers in the JS engine's zone, which on a phone is
 * whatever the phone was set to, with whatever zone data its OS image shipped.
 * That is how a 5:30 booking landed at 6:30 (`clinicTime.ts`). Clinic times go
 * through `clinicTime`; calendar arithmetic on keys runs in UTC (`dates.ts`).
 * The same trick as the app's `i18n/catalogue.test.ts`: read the source and
 * assert about it.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { Glob } from 'bun';

const ROOT = path.resolve(import.meta.dir, '../..');
const SCANNED = ['app/src', 'shared/src'];

/** Off the phone, where the zone data is the server's or the build machine's. */
const ALLOWED = new Set(['shared/src/zoneSpans.ts']);

const PHONE_ZONE = [
    /\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(/,
    /\.getTimezoneOffset\(/,
    /\.to(?:Locale)?(?:Date|Time)String\(/,
    // `new Date(year, month, …)` is a local wall-clock time.
    /new Date\(\s*[^,()]+,/,
    // The phone's ICU, which is as stale as its zone data.
    /Intl\.DateTimeFormat/,
];

async function offenders(): Promise<string[]> {
    const found: string[] = [];
    for (const dir of SCANNED) {
        for await (const file of new Glob('**/*.{ts,tsx}').scan(path.join(ROOT, dir))) {
            const relative = `${dir}/${file}`;
            if (ALLOWED.has(relative) || relative.endsWith('clinicTime.guard.test.ts')) continue;
            const lines = (await Bun.file(path.join(ROOT, relative)).text()).split('\n');
            lines.forEach((line, index) => {
                if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
                if (PHONE_ZONE.some((pattern) => pattern.test(line)))
                    found.push(`${relative}:${index + 1}: ${line.trim()}`);
            });
        }
    }
    return found;
}

describe("the phone's zone", () => {
    it('is never read or set outside clinicTime', async () => {
        expect(await offenders()).toEqual([]);
    });
});
