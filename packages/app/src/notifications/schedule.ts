import { instantAt, minutesOfDay } from '@lustre/shared';

const MAX_NUDGES = 24;

const DAY_MINUTES = 24 * 60;

export type NudgePlan = {
    at: Date[];
    silent: 'pending' | 'none-pending' | 'dismissed' | 'past-midnight' | null;
};

export type NudgeInput = {
    notifyAt: number;
    repeatMinutes: number;
    pendingCount: number;
    dismissedOn: string | null;
    today: string;
    now: number;
};

export function nudgePendingInput(offsetMinutes: number) {
    return { dueOnly: true, limit: 100, offsetMinutes, throughToday: true };
}

export function planNudges(input: NudgeInput): NudgePlan {
    const { notifyAt, repeatMinutes, pendingCount, dismissedOn, today, now } = input;

    if (pendingCount <= 0) return { at: [], silent: 'none-pending' };
    if (dismissedOn === today) return { at: [], silent: 'dismissed' };

    const nowMinutes = minutesOfDay(now);
    const step = Math.max(1, Math.trunc(repeatMinutes));

    const at: Date[] = [];
    for (let minutes = notifyAt; minutes < DAY_MINUTES && at.length < MAX_NUDGES; minutes += step) {
        if (minutes <= nowMinutes) continue;
        at.push(new Date(instantAt(today, minutes)));
    }

    if (at.length === 0) return { at: [], silent: 'past-midnight' };
    return { at, silent: 'pending' };
}

export function minutesOfClock(clock: string): number {
    const [hours = 0, minutes = 0] = clock.split(':').map(Number);
    const total = hours * 60 + minutes;
    if (!Number.isFinite(total)) return 0;
    return Math.min(DAY_MINUTES - 1, Math.max(0, Math.trunc(total)));
}
