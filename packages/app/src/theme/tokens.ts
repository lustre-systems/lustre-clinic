// Lustre design tokens — the single source of truth for the app's visual system,
// resolving the two design systems (Component Inventory §7.1). Components
// consume these through `StyleSheet.create`; nothing writes a raw hex, size or
// family.
//
// Invariants: `accent` never means "good", "paid" or "settled" and is not the
// primary button fill (the designs draw those in `ink`); semantic colours are
// status only, never interactive; `danger` is never used for money. `space` is
// keyed by 4px steps (`space[3]` is 12) and measured odd sizes snap to the
// grid. React Native selects a face by family name and never synthesises a
// weight, so always set `fontFamily`, never `fontWeight`; DM Mono ships 400 and
// 500 only, and heavier weights round down to 500. Letter-spacing is in px —
// React Native has no em. Android has historically flattened multi-layer
// `boxShadow` to a single elevation, so check `fab` on a physical device.

export const color = {
    canvas: '#f4f4f6',
    surface: '#ffffff',
    surface2: '#f0f0f3',
    hair: '#f1f1f4',
    line: '#ececef',
    outline: 'rgba(17,17,20,0.14)',

    ink: '#111114',
    ink2: '#3a3a40',
    muted: '#8b8b92',
    // A second series beside `ink`: the other branch on the stats screen's bars.
    inkFaint: '#b4b4bc',
    inverse: '#ffffff',

    // The money hero's ground, and the ramp that sits on it. Text on a dark
    // card is `inverse` at an opacity, but a hairline, a bar track and a
    // tinted figure each need their own value: an opacity on the card would
    // dim its contents along with them, and `success` / `due` are tuned for
    // white and go muddy on black.
    inkDeep: '#0e1116',
    onDarkLine: 'rgba(255,255,255,0.12)',
    onDarkHair: 'rgba(255,255,255,0.09)',
    onDarkTrack: 'rgba(255,255,255,0.14)',
    onDarkMuted: 'rgba(255,255,255,0.4)',
    successOnDark: '#8bf0b8',
    dueOnDark: '#ffb3b3',
    accentOnDark: '#a9bbff',
    // The stats chart's change chip, a good or a bad move, on the dark card.
    successOnDarkSoft: 'rgba(139,240,184,0.12)',
    dueOnDarkSoft: 'rgba(255,179,179,0.12)',
    onDarkGuide: 'rgba(255,255,255,0.25)',

    accent: '#2f5bff',
    accentSoft: '#eaeeff',
    accentText: '#1d3bc7',

    success: '#12a150',
    successSoft: '#e8f6ee',
    successText: '#0d7a3d',
    successBright: '#16c964',

    due: '#ef5f28',
    dueSoft: '#fdeee7',
    dueText: '#b3411a',

    // Money collected in this period against a visit charged in an earlier one.
    // A second green, deliberately: `success` means "this is settled" and this
    // means "this was settled late", which is the money screen's whole point.
    older: '#0e8a5c',

    danger: '#e5342a',
    dangerSoft: '#fce4e4',
    dangerText: '#b21e15',

    live: '#7dff9b',
    wa: '#1f9d54',

    scrim: 'rgba(17,17,20,0.34)',
    transparent: 'transparent',
} as const;

export const space = {
    0: 0,
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    4.5: 18,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    10: 40,
    12: 48,
} as const;

export const size = {
    gutter: 20,
    bleed: 16,
    row: 44,
    control: 48,
    button: 52,
    nav: 84,
    dock: 12,
} as const;

export const radius = {
    sm: 10,
    md: 12,
    lg: 14,
    xl: 16,
    xl2: 18,
    xl3: 24,
    xl4: 28,
    sheet: 26,
    full: 999,
} as const;

export const border = {
    hair: 1,
    thick: 1.5,
} as const;

export const font = {
    sans: {
        regular: 'InstrumentSans_400Regular',
        medium: 'InstrumentSans_500Medium',
        semibold: 'InstrumentSans_600SemiBold',
        bold: 'InstrumentSans_700Bold',
    },
    mono: {
        regular: 'DMMono_400Regular',
        medium: 'DMMono_500Medium',
        semibold: 'DMMono_500Medium',
        bold: 'DMMono_500Medium',
    },
    arabic: {
        regular: 'NotoNaskhArabic_400Regular',
        medium: 'NotoNaskhArabic_500Medium',
        semibold: 'NotoNaskhArabic_600SemiBold',
        bold: 'NotoNaskhArabic_700Bold',
    },
} as const;

export const type = {
    display: { fontSize: 34, lineHeight: 38, letterSpacing: -0.8 },
    title: { fontSize: 28, lineHeight: 32, letterSpacing: -0.6 },
    title2: { fontSize: 23, lineHeight: 28, letterSpacing: -0.4 },
    title3: { fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
    headline: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
    body: { fontSize: 15, lineHeight: 21, letterSpacing: 0 },
    callout: { fontSize: 14, lineHeight: 20, letterSpacing: 0 },
    subhead: { fontSize: 13, lineHeight: 18, letterSpacing: 0 },
    footnote: { fontSize: 12, lineHeight: 16, letterSpacing: 0 },
    caption: { fontSize: 11, lineHeight: 15, letterSpacing: 0 },
    hero: { fontSize: 68, lineHeight: 62, letterSpacing: -3.1 },
    figure: { fontSize: 30, lineHeight: 34, letterSpacing: 0 },
    figure2: { fontSize: 26, lineHeight: 30, letterSpacing: -0.65 },
    amount: { fontSize: 20, lineHeight: 24, letterSpacing: 0 },
    eyebrow: { fontSize: 10.5, lineHeight: 14, letterSpacing: 1.7 },
    tag: { fontSize: 9.5, lineHeight: 13, letterSpacing: 0.9 },
} as const;

export const shadow = {
    pill: '0 1px 2px rgba(17,17,20,0.06), 0 3px 8px rgba(17,17,20,0.05)',
    card: '0 4px 16px rgba(17,17,20,0.06)',
    dark: '0 6px 16px rgba(17,17,20,0.22)',
    hero: '0 16px 40px -10px rgba(0,0,0,0.45)',
    dock: '0 1px 2px rgba(17,17,20,0.05), 0 10px 28px -8px rgba(17,17,20,0.22)',
    fab: '0 8px 20px rgba(47,91,255,0.35)',
    // A selected stats tile lifts in its own colour.
    tileProfit: '0 8px 20px -8px #12a150',
    tileRevenue: '0 8px 20px -8px #111114',
    tileCost: '0 8px 20px -8px #ef5f28',
    tileNewPatients: '0 8px 20px -8px #2f5bff',
} as const;

// Gradients are CSS strings because React Native takes them as `background-
// image`, which is where the raw channel values have to live. Only the money
// hero has one: a green cast at the top-left where the collected figure sits
// and a warm one at the bottom-right by the due row, both far below the point
// where they would read as a colour rather than as depth.
//
// The stats chart's glow takes the colour of the metric on the chart, in the
// top-left and bottom-right corners, with the card's own ground between.
export const gradient = {
    hero: 'linear-gradient(135deg, rgba(22,201,100,0.12) 0%, rgba(10,12,16,0) 45%, rgba(255,179,179,0.08) 100%)',
    glowProfit:
        'linear-gradient(135deg, rgba(139,240,184,0.22) 0%, rgba(14,17,22,0) 45%, rgba(14,17,22,0) 55%, rgba(139,240,184,0.22) 100%)',
    glowRevenue:
        'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(14,17,22,0) 45%, rgba(14,17,22,0) 55%, rgba(255,255,255,0.22) 100%)',
    glowCost:
        'linear-gradient(135deg, rgba(255,179,179,0.22) 0%, rgba(14,17,22,0) 45%, rgba(14,17,22,0) 55%, rgba(255,179,179,0.22) 100%)',
    glowNewPatients:
        'linear-gradient(135deg, rgba(169,187,255,0.22) 0%, rgba(14,17,22,0) 45%, rgba(14,17,22,0) 55%, rgba(169,187,255,0.22) 100%)',
} as const;

export type Color = keyof typeof color;
export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type TypeVariant = keyof typeof type;
