import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { Glob } from 'bun';

const UI_ROOT = path.resolve(import.meta.dir);

const ALLOWED = [
    /^react$/,
    /^react\/.+/,
    /^react-native$/,
    /^react-native-safe-area-context$/,
    /^@gorhom\/bottom-sheet$/,
    /^\.\.\/\.\.\/i18n$/,
    /^\.\.\/\.\.\/theme$/,
    /^\.\/[\w.-]+$/,
];

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*'([^']+)'/g;

async function uiFiles(): Promise<string[]> {
    const glob = new Glob('*.{ts,tsx}');
    const files: string[] = [];
    for await (const file of glob.scan({ cwd: UI_ROOT })) {
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
        files.push(file);
    }
    return files;
}

describe('ui/ boundaries', () => {
    it('imports only react, react-native, the theme and its own siblings', async () => {
        const violations: string[] = [];

        for (const file of await uiFiles()) {
            const source = await Bun.file(path.join(UI_ROOT, file)).text();
            for (const match of source.matchAll(IMPORT)) {
                const specifier = match[1];
                if (specifier && !ALLOWED.some((allowed) => allowed.test(specifier))) {
                    violations.push(`${file}: ${specifier}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('has a file for every component the barrel exports', async () => {
        const barrel = await Bun.file(path.join(UI_ROOT, 'index.ts')).text();
        const files = new Set(await uiFiles());
        const missing: string[] = [];

        for (const match of barrel.matchAll(/from '\.\/([\w.-]+)'/g)) {
            const name = match[1];
            if (!name) continue;
            if (!files.has(`${name}.ts`) && !files.has(`${name}.tsx`)) missing.push(name);
        }

        expect(missing).toEqual([]);
    });
});
