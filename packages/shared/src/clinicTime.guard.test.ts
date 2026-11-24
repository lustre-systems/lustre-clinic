import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { Glob } from 'bun';

const ROOT = path.resolve(import.meta.dir, '../..');
const SCANNED = ['app/src', 'shared/src'];

const ALLOWED = new Set(['shared/src/zoneSpans.ts']);

const PHONE_ZONE = [
    /\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(/,
    /\.getTimezoneOffset\(/,
    /\.to(?:Locale)?(?:Date|Time)String\(/,
    /new Date\(\s*[^,()]+,/,
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
