import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { Glob } from 'bun';

const APP_ROOT = path.resolve(import.meta.dir, '../..');
const TOKENS = 'src/theme/tokens.ts';

async function sourceFiles(): Promise<string[]> {
    const glob = new Glob('{App.tsx,src/**/*.{ts,tsx}}');
    const files: string[] = [];
    for await (const file of glob.scan({ cwd: APP_ROOT })) {
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
        files.push(file);
    }
    return files;
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/;
const PHYSICAL =
    /\b(?:padding|margin|border)(?:Left|Right)(?:Width|Color|Radius)?\s*:|\b(?:left|right)\s*:\s*[-\d]|textAlign\s*:\s*'(?:left|right)'/;

async function violations(rule: RegExp, skip: (file: string) => boolean = () => false) {
    const found: string[] = [];
    for (const file of await sourceFiles()) {
        if (skip(file)) continue;
        const source = stripComments(await Bun.file(path.join(APP_ROOT, file)).text());
        for (const [index, line] of source.split('\n').entries()) {
            if (rule.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
        }
    }
    return found;
}

describe('design tokens', () => {
    it('no raw colour values outside tokens.ts', async () => {
        expect(await violations(RAW_COLOR, (file) => file === TOKENS)).toEqual([]);
    });

    it('no physical-direction style properties', async () => {
        expect(await violations(PHYSICAL)).toEqual([]);
    });
});
