import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { color, font, type } from './tokens';

// The type ramp: a screen picks a variant, never a size, line height or family
// (adding a size means adding it to `type` in tokens.ts and naming it here).
// The face is chosen per string — a clinic holds Arabic and Latin labels in one
// list, so an Arabic label gets Noto Naskh even on an English screen. Mono
// variants (figure, amount, eyebrow, tag) stay in DM Mono even inside Arabic:
// it has no Arabic-Indic coverage and swapping faces would break tabular
// alignment (§7.11). The `live` tone is legible on `ink` only — never on a
// white ground.
//
// **The ramp is the scale, and the OS does not get a vote.** `allowFontScaling`
// defaults to false here, which is the one place it has to be set for the whole
// app to obey it. Android's font size setting multiplies every point size — a
// phone on 1.3 renders the whole ramp 30% over the tokens — and this design
// sizes its containers in fixed dp against those tokens: an 80dp time column,
// a `size.row` list item, a chip built to fit its label. Scaled type in a fixed
// box does not reflow, it clips, and the first thing to go is the meridiem on a
// clock. Honouring the setting properly means every one of those containers
// growing with it, which is a different design, not a prop.
//
// A screen that genuinely wants to scale passes `allowFontScaling` itself.
export type TextVariant = keyof typeof type;

export type TextWeight = keyof typeof font.sans;

export type TextTone =
    | 'ink'
    | 'ink2'
    | 'muted'
    | 'accent'
    | 'success'
    | 'due'
    | 'danger'
    | 'wa'
    | 'inverse'
    | 'live'
    | 'older'
    | 'dueText'
    | 'successText'
    | 'successOnDark'
    | 'dueOnDark'
    | 'accentText'
    | 'accentOnDark';

type Script = keyof typeof font;

const MONO_VARIANTS: ReadonlySet<TextVariant> = new Set<TextVariant>([
    'figure',
    'figure2',
    'amount',
    'eyebrow',
    'tag',
]);

const UPPERCASE_VARIANTS: ReadonlySet<TextVariant> = new Set<TextVariant>(['eyebrow', 'tag']);

const DEFAULT_WEIGHT: Record<TextVariant, TextWeight> = {
    display: 'bold',
    title: 'bold',
    title2: 'bold',
    title3: 'semibold',
    headline: 'semibold',
    body: 'regular',
    callout: 'regular',
    subhead: 'regular',
    footnote: 'regular',
    caption: 'regular',
    hero: 'bold',
    figure: 'medium',
    figure2: 'medium',
    amount: 'medium',
    eyebrow: 'medium',
    tag: 'medium',
};

const TONE: Record<TextTone, string> = {
    ink: color.ink,
    ink2: color.ink2,
    muted: color.muted,
    accent: color.accent,
    success: color.success,
    due: color.due,
    danger: color.danger,
    wa: color.wa,
    inverse: color.inverse,
    live: color.live,
    older: color.older,
    dueText: color.dueText,
    successText: color.successText,
    successOnDark: color.successOnDark,
    dueOnDark: color.dueOnDark,
    accentText: color.accentText,
    accentOnDark: color.accentOnDark,
};

const styles = StyleSheet.create({
    uppercase: { textTransform: 'uppercase' },
    // Android reserves the font's own ascent/descent padding above and below
    // every Text on top of `lineHeight`, so a measured 20px gap in a design
    // renders as 26–28 and a card of stacked labels drifts taller than it was
    // drawn. The ramp already states the line height it wants; this stops the
    // platform adding to it. iOS has no equivalent and ignores the property.
    metrics: { includeFontPadding: false },
    // Tracking is a Latin adjustment. Naskh is a connected script that has no
    // gaps to tighten, and on Android a negative value makes the measure pass
    // come in narrower than the draw, so a title wraps its last word onto a
    // second line inside a card that had room for it.
    arabic: { letterSpacing: 0 },
});

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export function containsArabic(node: React.ReactNode): boolean {
    if (typeof node === 'string') return ARABIC.test(node);
    if (Array.isArray(node)) return node.some(containsArabic);
    return false;
}

export type TextProps = RNTextProps & {
    variant?: TextVariant;
    weight?: TextWeight;
    tone?: TextTone;
    script?: Script;
};

export function Text({
    variant = 'body',
    weight,
    tone = 'ink',
    script,
    style,
    children,
    allowFontScaling = false,
    ...rest
}: TextProps) {
    const resolvedScript: Script =
        script ?? (MONO_VARIANTS.has(variant) ? 'mono' : containsArabic(children) ? 'arabic' : 'sans');

    return (
        <RNText
            allowFontScaling={allowFontScaling}
            style={[
                type[variant],
                styles.metrics,
                { fontFamily: font[resolvedScript][weight ?? DEFAULT_WEIGHT[variant]], color: TONE[tone] },
                UPPERCASE_VARIANTS.has(variant) && styles.uppercase,
                resolvedScript === 'arabic' && styles.arabic,
                style,
            ]}
            {...rest}
        >
            {children}
        </RNText>
    );
}
