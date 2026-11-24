export const STEP_SHIFT = 24;

export type StepDirection = 'forward' | 'back' | 'none';

export function stepDirection(from: number, to: number): StepDirection {
    if (to > from) return 'forward';
    if (to < from) return 'back';
    return 'none';
}

export function stepOffset(direction: StepDirection, isRTL: boolean): number {
    if (direction === 'none') return 0;
    const shift = direction === 'forward' ? STEP_SHIFT : -STEP_SHIFT;
    return isRTL ? -shift : shift;
}
