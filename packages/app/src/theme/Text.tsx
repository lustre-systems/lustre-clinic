import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { color, font, type } from './tokens';

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
    metrics: { includeFontPadding: false },
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
