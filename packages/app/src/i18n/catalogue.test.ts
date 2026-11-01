/**
 * Every English string the app shows has an Arabic one behind it.
 *
 * The sweep that added the catalogue is only half the work: the half that rots
 * is the next screen, written in English, shipping a row that stays English
 * when the toggle is flipped. Nothing else catches that — `localizeCopy` falls
 * back to the English key by design, so a missing entry is silent at runtime
 * and invisible in review. This is the same trick `theme/tokens.test.ts` and
 * `components/ui/boundaries.test.ts` use: read the source and assert about it.
 *
 * Two shapes are scanned, because copy reaches the user two ways:
 *
 * - `t('…')` — a screen localizing its own string.
 * - A copy prop on a primitive that localizes for its callers, such as
 *   `<Button label="Save" />`. `COPY_PROPS` is that list, and it has to be a
 *   list: `title` on a `Sheet` is copy, `name` on anything is a patient.
 * - The *children* of a primitive that localizes them rather than a prop —
 *   `<SectionLabel>BOOKED ANYWAY</SectionLabel>`. `COPY_CHILDREN` is that
 *   list. This is the shape the first sweep missed: the eyebrow over the
 *   closed day's appointments stayed English because nothing looked here.
 *
 * Only string literals are checked. A value built at runtime — a branch name, a
 * formatted total, an already-localized `ERROR_CODE` sentence — cannot be
 * checked here and is not meant to be.
 */
import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { COPY_AR } from '@lustre/shared';
import { Glob } from 'bun';

const SRC = path.resolve(import.meta.dir, '..');

/** Props whose value is copy the primitive itself puts through `t`. */
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
    // `Placeholder`'s, which draws it through `t`.
    'text',
    // `ConfirmSheet`'s and `EmptyState`'s.
    'body',
    // `ActionBar`'s, handed on to a `Button`.
    'primaryLabel',
    'secondaryLabel',
    // `Field`'s, which draws a rule's sentence through `t`.
    'error',
    // A settings row's second line.
    'sub',
];

/**
 * Copy that reaches a primitive as a field of an object rather than as a prop:
 * a `SegmentedControl`'s `segments`, a `DropdownMenu`'s `options`, a
 * `PopoverMenu`'s `items`. Each of those draws the field through `t`, so the
 * literal is shown copy and belongs in the catalogue — and a prop scan never
 * sees it, which is how `{ value: 'treatment', label: 'Treatment' }` sat on
 * the visit's tab strip in English with this test passing.
 */
const ITEM_FIELDS = ['label'];

/**
 * `api/demo/` is seed rows, not screens: a custom question there carries its
 * own `labelAr` column and is localized as data, the way a real clinic's
 * questions are.
 */
const ITEM_SKIP = ['api/'];

/** Primitives that put their own children through `t`. */
const COPY_CHILDREN = ['SectionLabel', 'Tag', 'Callout'];

const T_CALL = /\bt\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
const PROP = new RegExp(`\\b(?:${COPY_PROPS.join('|')})=(?:"([^"]+)"|\\{'([^']+)'\\})`, 'g');
const ITEM = new RegExp(`\\b(?:${ITEM_FIELDS.join('|')}):\\s*'([^']+)'`, 'g');
// The opening tag may carry a JSX prop — `icon={<InfoIcon size={16} />}` —
// so its attributes are matched as anything outside braces or a brace pair
// nested one deep, not as "anything but `<`". The first form missed the
// inactive-branch notice for exactly that prop.
const CHILD = new RegExp(
    `<(${COPY_CHILDREN.join('|')})\\b(?:[^<>{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*>\\s*([A-Za-z][^<>{}]*?)\\s*</\\1>`,
    'g',
);

/**
 * `screens/dev/` is the component gallery, which is not in the production
 * navigator and is read by whoever is building a primitive, in English.
 */
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

/**
 * A `{day}` slot is filled in at runtime and is part of the key, so it is the
 * words around it that decide whether a literal is copy at all. That keeps
 * `testID`s, icon names and `100.x` out of the catalogue.
 */
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

    /**
     * The shapes a bare-literal scan cannot see, each of which shipped English
     * into the Arabic layout:
     *
     * - A literal inside a copy prop's expression — `title={branch ? 'Edit
     *   branch' : 'New branch'}`. The primitive still puts it through `t`, so
     *   it only needs an entry.
     * - A template literal with words in it, in a copy prop or passed to `t` —
     *   `` label={`Go to this day in ${name}`} ``. No entry can match it: it has
     *   to become `t('Go to this day in {branch}', { branch })`.
     * - Copy as the children of `Text`, which does not localize — a literal,
     *   or either side of a ternary. It has to go through `t` first.
     * - A literal handed to something that shows it later: a toast setter, an
     *   `onSaved` callback, `localizeCopy`, the date helpers' `say`, and the
     *   sentence tables in each cluster's `errors.ts`.
     * - A template handed to a toast setter, or to a callback a parent toasts —
     *   `` setToast(`${name} is at the desk`) ``. The toast puts its message
     *   through `t`, but no key matches a filled-in name, so these stayed
     *   English in Arabic with this test passing.
     *
     * The expression scans only count a literal as copy when it reads like a
     * sentence — capitalised, or more than one word — so the `'book'` in
     * `mode === 'book' ? …` is not mistaken for something shown.
     */
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

            // Every cluster maps the server's `ERROR_CODE` to its own sentence,
            // not only the ones in a file called `errors.ts`.
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

/** `BrandMark` draws the wordmark's letters, which are a logo rather than copy. */
const NOT_COPY = ['components/domain/BrandMark.tsx'];

/** Comments are prose about the code, and quote copy they do not show. */
function withoutComments(text: string): string {
    return text.replace(
        /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
        (_match, literal: string | undefined) => literal ?? ' ',
    );
}

/** Where a call has already localized its argument, there is nothing left to check. */
function stripLocalized(code: string): string {
    return cutBalanced(code, /\b(?:t|say|localizeCopy)\(/g, '(', ')');
}

/** A template's `${…}` slots are values, not words; they can nest braces of their own. */
function withoutSlots(template: string): string {
    return cutBalanced(template, /\$\{/g, '{', '}');
}

/**
 * A JSX expression that is nothing but a template — `{`checked in ${time}`}` as
 * a child, or a prop no primitive localizes. Words in it are English on the
 * screen whatever the language.
 */
const JSX_TEMPLATE = /(?:>|(?<!\b(?:key|testID|nativeID))=)\s*\{\s*`([^`]*)`\s*\}/g;

/** `[ERROR_CODE.NOT_FOUND]: 'That visit no longer exists.'` in any map. */
const ERROR_SENTENCE = /\[ERROR_CODE\.\w+\]:\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;

/**
 * A toast setter, or a callback whose argument a parent hands to one: whatever
 * it is handed is shown, ternaries and templates and all.
 */
const SHOWN_BY =
    /\b(?:set\w*Toast|onSaved|showToast|onBooked|onSentToDesk|onClosed|onFailed|onDone|onReturn)\(/g;

/** The argument list of every call `start` opens. */
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

/** Blanks out each match of `start` through the bracket that closes it. */
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

/** The `{…}` of every copy prop, braces balanced two deep. */
function copyPropExpressions(text: string): string[] {
    const pattern = new RegExp(
        `\\b(?:${COPY_PROPS.join('|')})=\\{((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)\\}`,
        'g',
    );
    return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

/** What sits between `<Text …>` and its `</Text>`, when it holds no other tag. */
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

/** A literal handed to something that shows it later. */
const SHOWN_LATER =
    /\b(?:set\w*Toast|onSaved|showToast|say|localizeCopy\(\s*[\w.()]+\s*,)\(?\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;

/**
 * A sentence parked in a variable on its way to a copy prop — `const nameError
 * = submitted && … ? 'A branch needs a name.' : undefined` — named for the prop
 * it is headed for.
 */
const COPY_BINDING = /\bconst \w*(?:[Ee]rror|Label|Title|Message|Hint|Body)\b[^=\n]*=([^;]*);/g;

/** `t` handed a template literal that carries words: no catalogue key can match it. */
const T_TEMPLATE = /\bt\(\s*(`)([^`]*)`/g;
