import { GLYPH, type Glyph } from '../../../components/domain';
import { color, gradient, shadow, type TextTone } from '../../../theme';
import type { Metric } from '../stats';

type Skin = {
    soft: string;
    text: TextTone;
    textColor: string;
    glyph: Glyph;
    solid: string;
    lift: string;
    onDark: string;
    onDarkTone: TextTone;
    glow: string;
    fillOpacity: number;
};

export const SKIN: Record<Metric, Skin> = {
    profit: {
        soft: color.successSoft,
        text: 'successText',
        textColor: color.successText,
        glyph: GLYPH.statProfit,
        solid: color.success,
        lift: shadow.tileProfit,
        onDark: color.successOnDark,
        onDarkTone: 'successOnDark',
        glow: gradient.glowProfit,
        fillOpacity: 0.1,
    },
    revenue: {
        soft: color.surface2,
        text: 'ink',
        textColor: color.ink,
        glyph: GLYPH.statRevenue,
        solid: color.ink,
        lift: shadow.tileRevenue,
        onDark: color.inverse,
        onDarkTone: 'inverse',
        glow: gradient.glowRevenue,
        fillOpacity: 0.08,
    },
    cost: {
        soft: color.dueSoft,
        text: 'dueText',
        textColor: color.dueText,
        glyph: GLYPH.statCost,
        solid: color.due,
        lift: shadow.tileCost,
        onDark: color.dueOnDark,
        onDarkTone: 'dueOnDark',
        glow: gradient.glowCost,
        fillOpacity: 0.1,
    },
    newPatients: {
        soft: color.accentSoft,
        text: 'accentText',
        textColor: color.accentText,
        glyph: GLYPH.statNewPatients,
        solid: color.accent,
        lift: shadow.tileNewPatients,
        onDark: color.accentOnDark,
        onDarkTone: 'accentOnDark',
        glow: gradient.glowNewPatients,
        fillOpacity: 0.1,
    },
};
