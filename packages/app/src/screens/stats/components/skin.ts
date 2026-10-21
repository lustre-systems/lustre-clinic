// Each metric's colours, in one place so the tile and the chart it puts a line
// on always agree. Not selected, a tile is its soft ground and text colour;
// selected, it is the solid fill with white text. On the black chart card the
// line, the area, the dot and the glow take the metric's on-dark colour.
import { color, gradient, shadow, type TextTone } from '../../../theme';
import type { Metric } from '../stats';

type Skin = {
    soft: string;
    text: TextTone;
    solid: string;
    lift: string;
    onDark: string;
    onDarkTone: TextTone;
    glow: string;
    /** The area under the line. White reads brighter than the tints, so it takes less. */
    fillOpacity: number;
};

export const SKIN: Record<Metric, Skin> = {
    profit: {
        soft: color.successSoft,
        text: 'successText',
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
        solid: color.accent,
        lift: shadow.tileNewPatients,
        onDark: color.accentOnDark,
        onDarkTone: 'accentOnDark',
        glow: gradient.glowNewPatients,
        fillOpacity: 0.1,
    },
};
