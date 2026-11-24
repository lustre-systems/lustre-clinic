import type { AlarmDismissal } from '../../modules/lustre-alarm';

export type DismissalDeps = {
    read: () => AlarmDismissal | null;
    send: (day: string) => Promise<unknown>;
    markSent: (day: string) => void;
    clear: () => void;
    today: () => string;
    reread: () => void;
    rearm: () => void;
    later: (retry: () => void, ms: number) => () => void;
    retryMs: number;
    now: () => number;
};

export function effectiveDismissedOn(
    server: string | null,
    held: AlarmDismissal | null,
    today: string,
): string | null {
    return held?.day === today ? today : server;
}

export function createDismissalSync(deps: DismissalDeps) {
    let sending = false;
    let cancelRetry: (() => void) | null = null;
    let sentAt = 0;

    async function sync(): Promise<void> {
        cancelRetry?.();
        cancelRetry = null;
        const held = deps.read();
        if (!held || sending) return;

        if (held.day !== deps.today()) {
            deps.clear();
            deps.reread();
            return;
        }
        if (held.sent) return;

        sending = true;
        try {
            await deps.send(held.day);
            deps.markSent(held.day);
            sentAt = deps.now();
            deps.reread();
            deps.rearm();
        } catch {
            cancelRetry = deps.later(() => void sync(), deps.retryMs);
        } finally {
            sending = false;
        }
    }

    function settle(fetchedAt: number, serverDismissedOn: string | null): void {
        const held = deps.read();
        if (!held) return;
        if (held.day !== deps.today()) {
            void sync();
            return;
        }
        if (held.sent && fetchedAt > sentAt && serverDismissedOn === held.day) {
            deps.clear();
            deps.reread();
        }
    }

    function stop(): void {
        cancelRetry?.();
        cancelRetry = null;
    }

    return { sync, settle, stop };
}
