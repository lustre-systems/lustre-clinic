import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { COPY_AR } from '@lustre/shared';
import { Glob } from 'bun';

const SRC = path.resolve(import.meta.dir, '..');

const COPY_PROPS = [
    'label',
    'title',
    'subtitle',
    'sheetTitle',
    'placeholder',
    'hint',
    'message',
    'actionLabel',
    'confirmLabel',
    'cancelLabel',
    'accessibilityLabel',
    'accessibilityHint',
    'eyebrow',
    'backLabel',
    'text',
    'body',
    'primaryLabel',
    'secondaryLabel',
    'error',
    'sub',
];

const ITEM_FIELDS = ['label'];

const ITEM_SKIP = ['api/'];

const COPY_CHILDREN = ['SectionLabel', 'Tag', 'Callout'];

const T_CALL = /\bt\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
const PROP = new RegExp(`\\b(?:${COPY_PROPS.join('|')})=(?:"([^"]+)"|\\{'([^']+)'\\})`, 'g');
const ITEM = new RegExp(`\\b(?:${ITEM_FIELDS.join('|')}):\\s*'([^']+)'`, 'g');
const CHILD = new RegExp(
    `<(${COPY_CHILDREN.join('|')})\\b(?:[^<>{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*>\\s*([A-Za-z][^<>{}]*?)\\s*</\\1>`,
    'g',
);

const SKIP = ['screens/dev/'];

function unquoted(literal: string): string {
    return literal.replace(/\\(['"\\])/g, '$1');
}

async function sources(): Promise<{ file: string; text: string }[]> {
    const glob = new Glob('**/*.{ts,tsx}');
    const out: { file: string; text: string }[] = [];
    for await (const file of glob.scan({ cwd: SRC })) {
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
        if (SKIP.some((skipped) => file.startsWith(skipped))) continue;
        out.push({ file, text: await Bun.file(path.join(SRC, file)).text() });
    }
    return out;
}

function isCopy(value: string): boolean {
    return /[A-Za-z]/.test(value.replace(/\{\w+\}/g, ''));
}

describe('copy catalogue', () => {
    it('has an Arabic entry for every English literal the app shows', async () => {
        const missing = new Set<string>();

        for (const { file, text } of await sources()) {
            for (const pattern of [T_CALL, PROP, ITEM, CHILD]) {
                if (pattern === ITEM && ITEM_SKIP.some((skipped) => file.startsWith(skipped))) continue;
                pattern.lastIndex = 0;
                for (const match of text.matchAll(pattern)) {
                    const raw = pattern === CHILD ? match[2] : (match[2] ?? match[1] ?? match[3]);
                    if (raw === undefined) continue;
                    const value = unquoted(raw.replace(/\s+/g, ' ').trim());
                    if (!isCopy(value)) continue;
                    if (value in COPY_AR) continue;
                    missing.add(`${value}  (${file})`);
                }
            }
        }

        expect([...missing].sort()).toEqual([]);
    });

    it('has an Arabic entry for copy that reaches the screen by any other route', async () => {
        const missing = new Set<string>();
        const add = (value: string, file: string, why = '') => missing.add(`${value}${why}  (${file})`);

        for (const source of await sources()) {
            const { file } = source;
            if (NOT_COPY.includes(file)) continue;
            const text = withoutComments(source.text);
            for (const expression of copyPropExpressions(text)) {
                for (const literal of literalsIn(stripLocalized(expression))) {
                    if (!readsAsCopy(literal) || literal in COPY_AR) continue;
                    add(literal, file);
                }
                for (const template of templatesIn(expression))
                    add(template, file, '  [template: use t with a {slot}]');
            }

            for (const match of text.matchAll(JSX_TEMPLATE)) {
                const template = match[1] ?? '';
                if (/(?:^|\s)[A-Za-z]{2,}(?:\s|$)/.test(withoutSlots(template))) {
                    add(template, file, '  [template: use t with a {slot}]');
                }
            }

            for (const children of textChildren(text)) {
                const plain = stripLocalized(children);
                const bare = plain
                    .replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (/[A-Za-z]{2}/.test(bare)) add(bare, file, '  [Text child: wrap in t]');
                for (const literal of literalsIn(plain)) {
                    if (readsAsCopy(literal)) add(literal, file, '  [Text child: wrap in t]');
                }
                for (const template of templatesIn(plain)) {
                    if (/(?:^|\s)[A-Za-z]{2,}(?:\s|$)/.test(withoutSlots(template))) {
                        add(template, file, '  [Text child: use t with a {slot}]');
                    }
                }
            }

            for (const match of text.matchAll(COPY_BINDING)) {
                for (const literal of literalsIn(stripLocalized(match[1] ?? ''))) {
                    if (readsAsCopy(literal) && !(literal in COPY_AR)) add(literal, file);
                }
            }

            for (const args of callArguments(text, SHOWN_BY)) {
                const plain = stripLocalized(args);
                for (const literal of literalsIn(plain)) {
                    if (readsAsCopy(literal) && !(literal in COPY_AR)) add(literal, file);
                }
                for (const template of templatesIn(plain)) {
                    if (/(?:^|\s)[A-Za-z]{2,}(?:\W|$)/.test(withoutSlots(template))) {
                        add(template, file, '  [template: use t with a {slot}]');
                    }
                }
            }

            for (const pattern of [SHOWN_LATER, T_TEMPLATE]) {
                pattern.lastIndex = 0;
                for (const match of text.matchAll(pattern)) {
                    const raw = match[2] ?? '';
                    if (pattern === T_TEMPLATE) {
                        if (isCopy(withoutSlots(raw))) add(raw, file, '  [template: use t with a {slot}]');
                        continue;
                    }
                    const value = unquoted(raw.replace(/\s+/g, ' ').trim());
                    if (isCopy(value) && !(value in COPY_AR)) add(value, file);
                }
            }

            for (const match of text.matchAll(ERROR_SENTENCE)) {
                const value = unquoted(match[2] ?? '');
                if (!(value in COPY_AR)) add(value, file);
            }

            if (file.endsWith('errors.ts')) {
                for (const literal of literalsIn(text)) {
                    if (/ .*\.$/.test(literal) && !(literal in COPY_AR)) add(literal, file);
                }
            }
        }

        expect([...missing].sort()).toEqual([]);
    });
});

const NOT_COPY = ['components/domain/BrandMark.tsx'];

function withoutComments(text: string): string {
    return text.replace(
        /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        (_match, literal: string | undefined) => literal ?? ' ',
    );
}

function stripLocalized(code: string): string {
    return cutBalanced(code, /\b(?:t|say|localizeCopy)\(/g, '(', ')');
}

function withoutSlots(template: string): string {
    return cutBalanced(template, /\$\{/g, '{', '}');
}

const JSX_TEMPLATE = /(?:>|(?<!\b(?:key|testID|nativeID))=)\s*\{\s*`([^`]*)`\s*\}/g;

const ERROR_SENTENCE = /\[ERROR_CODE\.\w+\]:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;

const SHOWN_BY =
    /\b(?:set\w*Toast|onSaved|showToast|onBooked|onSentToDesk|onClosed|onFailed|onDone|onReturn)\(/g;

function callArguments(code: string, start: RegExp): string[] {
    const out: string[] = [];
    start.lastIndex = 0;
    for (let match = start.exec(code); match; match = start.exec(code)) {
        let depth = 1;
        let end = match.index + match[0].length;
        while (end < code.length && depth > 0) {
            if (code[end] === '(') depth++;
            else if (code[end] === ')') depth--;
            end++;
        }
        out.push(code.slice(match.index + match[0].length, end - 1));
    }
    return out;
}

function cutBalanced(code: string, start: RegExp, open: string, close: string): string {
    let out = '';
    let from = 0;
    start.lastIndex = 0;
    for (let match = start.exec(code); match; match = start.exec(code)) {
        if (match.index < from) continue;
        let depth = 1;
        let end = match.index + match[0].length;
        while (end < code.length && depth > 0) {
            if (code[end] === open) depth++;
            else if (code[end] === close) depth--;
            end++;
        }
        out += `${code.slice(from, match.index)} `;
        from = end;
        start.lastIndex = end;
    }
    return out + code.slice(from);
}

function copyPropExpressions(text: string): string[] {
    const pattern = new RegExp(
        `\\b(?:${COPY_PROPS.join('|')})=\\{((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)\\}`,
        'g',
    );
    return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

function textChildren(text: string): string[] {
    const pattern =
        /<Text\b(?:[^<>{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*>((?:(?!<\/?Text\b)[^<])*)<\/Text>/g;
    return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

function literalsIn(code: string): string[] {
    return [...code.matchAll(/(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((match) => unquoted(match[2] ?? ''));
}

function templatesIn(code: string): string[] {
    return [...code.matchAll(/`([^`]*)`/g)]
        .map((match) => match[1] ?? '')
        .filter((template) => isCopy(withoutSlots(template)));
}

function readsAsCopy(value: string): boolean {
    return isCopy(value) && (/^[A-Z][a-z]/.test(value) || /[A-Za-z0-9]+ [A-Za-z]{2,}/.test(value));
}

const SHOWN_LATER =
    /\b(?:set\w*Toast|onSaved|showToast|say|localizeCopy\(\s*[\w.()]+\s*,)\(?\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;

const COPY_BINDING = /\bconst \w*(?:[Ee]rror|Label|Title|Message|Hint|Body)\b[^=\n]*=([^;]*);/g;

const T_TEMPLATE = /\bt\(\s*(`)([^`]*)`/g;
