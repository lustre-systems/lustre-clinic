/**
 * Done for today, pressed on the ringing alarm or the plain nudge. The native
 * side stops the rest of the day's series on its own and keeps the press on
 * disk (`modules/lustre-alarm`, `Dismissal.kt`), because it can be pressed with
 * the app killed. Telling the server is this file's job: `reminder.dismissToday`
 * is what the other desk phone reads before it rings, and what this phone's
 * plan reads once the press is forgotten.
 *
 * This is the one write the app queues and retries, against the rule that a
 * failed write shows as failed: there is no screen to show it on. It was made
 * on a lock screen, and the clinic PC being out of reach then is ordinary.
 * Sending it twice is harmless; it only ever sets the day it was pressed on.
 *
 * No `react-native` and no native module in here, like `schedule.ts`: the
 * steps are handed in, so the rule is tested.
 */
import type { AlarmDismissal } from '../../modules/lustre-alarm';

export type DismissalDeps = {
    /** What the native side holds now. */
    read: () => AlarmDismissal | null;
    send: (day: string) => Promise<unknown>;
    markSent: (day: string) => void;
    clear: () => void;
    /** The clinic's `YYYY-MM-DD` now. */
    today: () => string;
    /** The held press moved: read it again. */
    reread: () => void;
    /** The server's settings moved: read them again, which re-arms the nudge. */
    rearm: () => void;
    /** Runs `retry` after `ms`; returns a cancel. */
    later: (retry: () => void, ms: number) => () => void;
    retryMs: number;
    /** Epoch ms, for when the server took it. */
    now: () => number;
};

/**
 * The dismissedOn the plan is made with. This phone's own press counts until
 * the settings have been read back after the server took it, so a re-arm in
 * between does not undo it.
 */
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
    // In memory: a press sent by a process that has since died was read back by
    // every settings answer this one has.
    let sentAt = 0;

    async function sync(): Promise<void> {
        cancelRetry?.();
        cancelRetry = null;
        const held = deps.read();
        if (!held || sending) return;

        // An older day's press is spent: tomorrow arms on its own. Sending it
        // now would overwrite a dismissal the other phone made today.
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

    /**
     * The settings were read at `fetchedAt`. Once that is after the server took
     * the press, the server's `reminderDismissedOn` speaks for it, and goes on
     * speaking if the press is turned back on from the other phone.
     */
    function settle(fetchedAt: number): void {
        const held = deps.read();
        if (!held) return;
        if (held.day !== deps.today()) {
            void sync();
            return;
        }
        if (held.sent && fetchedAt > sentAt) {
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
