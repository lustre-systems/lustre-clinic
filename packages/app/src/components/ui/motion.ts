/**
 * Theme is values-only and holds no motion, so the curves live with the
 * components that animate (Component Inventory §3.4); durations are ms. The
 * easings are the designs' own curves: sheet `.32,.72,0,1`, promote
 * `.22,.9,.3,1`, spring `.34,1.4,.5,1`. Every design ends with a
 * `prefers-reduced-motion` block; components read the RN signal via
 * `useReducedMotion` and fall through to duration 0 rather than skipping, so the
 * end state is always applied. `PULSE` is the 2s keyframe (1 → .35 → 1, 1000ms
 * per half).
 */
import { Easing } from 'react-native';

export const duration = {
    fade: 200,
    sheet: 300,
    push: 300,
    promote: 420,
    fadeup: 280,
    toast: 220,
    /** The longest a swiped toast takes to leave; a fast flick leaves sooner. */
    swipe: 200,
    collapse: 240,
    popover: 160,
    /** A field's menu unfolding; it folds away at `popover`. */
    drop: 260,
    step: 240,
    /** A chart line drawing itself in, end to end. */
    draw: 700,
} as const;

export const easing = {
    sheet: Easing.bezier(0.32, 0.72, 0, 1),
    promote: Easing.bezier(0.22, 0.9, 0.3, 1),
    spring: Easing.bezier(0.34, 1.4, 0.5, 1),
    standard: Easing.out(Easing.quad),
    linear: Easing.linear,
} as const;

export const PULSE = { min: 0.35, duration: 1000 } as const;
