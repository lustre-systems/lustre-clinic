import { TRPC_ENDPOINT } from '@lustre/shared';
import type { AlarmCheck } from '../../modules/lustre-alarm';

export type AlarmCheckInput = {
    demo: boolean;
    current: string | null;
    lan: string | null;
    tailscale: string | null;
    today: string;
    offsetMinutes: number;
};

export function alarmCheck(input: AlarmCheckInput): AlarmCheck | null {
    if (input.demo) return null;

    const bases = [...new Set([input.current, input.lan, input.tailscale].filter((base) => base !== null))];
    if (bases.length === 0) return null;

    const pending = { dueOnly: true, limit: 1, offsetMinutes: input.offsetMinutes, throughToday: true };

    return {
        bases,
        pendingPath: `${TRPC_ENDPOINT}/reminder.pending?input=${encodeURIComponent(JSON.stringify(pending))}`,
        settingsPath: `${TRPC_ENDPOINT}/settings.get`,
        today: input.today,
    };
}
