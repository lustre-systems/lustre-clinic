import { Easing } from 'react-native';

export const duration = {
    fade: 200,
    sheet: 300,
    push: 300,
    promote: 420,
    fadeup: 280,
    toast: 220,
    swipe: 200,
    collapse: 240,
    popover: 160,
    drop: 260,
    step: 240,
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
