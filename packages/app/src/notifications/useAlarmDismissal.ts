/**
 * Carries Done for today from the ringing alarm or a nudge to the server
 * (`dismissal.ts` has the rule). Sent when the app comes up or back, when the
 * press lands with the app running, and again every minute while the clinic PC
 * cannot be reached.
 *
 * The press as the native side holds it is a module store, so the nudge's plan
 * and the reminders tab read the same one.
 */
import { todayKey } from '@lustre/shared';
import { useQuery } from '@tanstack/react-query';
// biome-ignore lint/style/noRestrictedImports: subscribes to the native Done press, `AppState` and `/ws`, and runs the retry timer
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
    type AlarmDismissal,
    alarmDismissal,
    alarmDismissalSent,
    clearAlarmDismissal,
    dismissAlarmsFor,
    onAlarmDismissed,
} from '../../modules/lustre-alarm';
import { onServerChange, trpcClient, useTRPC } from '../api';
import { createDismissalSync, effectiveDismissedOn } from './dismissal';
import { onNudgeDone } from './notifications';

const RETRY_MS = 60_000;

const listeners = new Set<() => void>();
let held: AlarmDismissal | null | undefined;

function readHeld(): AlarmDismissal | null {
    if (held === undefined) held = alarmDismissal();
    return held;
}

function reread(): void {
    const next = alarmDismissal();
    if (next?.day === held?.day && next?.sent === held?.sent) return;
    held = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Forgets this phone's press, for Turn back on: the native side would otherwise keep today quiet. */
export function forgetAlarmDismissal(): void {
    clearAlarmDismissal();
    reread();
}

/**
 * Sends a held press and returns it. `settingsFetchedAt` is when the settings
 * this phone plans with were read; `rearm` re-reads them.
 */
export function useAlarmDismissal(rearm: () => void, settingsFetchedAt: number): AlarmDismissal | null {
    const current = useSyncExternalStore(subscribe, readHeld);
    const sync = useRef<ReturnType<typeof createDismissalSync> | null>(null);

    useEffect(() => {
        const engine = createDismissalSync({
            read: alarmDismissal,
            send: (date) => trpcClient.reminder.dismissToday.mutate({ date }),
            markSent: alarmDismissalSent,
            clear: clearAlarmDismissal,
            today: () => todayKey(),
            reread,
            rearm,
            later: (retry, ms) => {
                const timer = setTimeout(retry, ms);
                return () => clearTimeout(timer);
            },
            retryMs: RETRY_MS,
            now: Date.now,
        });
        sync.current = engine;

        const run = () => {
            reread();
            void engine.sync();
        };
        run();
        const foreground = AppState.addEventListener('change', (state) => {
            if (state === 'active') run();
        });
        const pressed = onAlarmDismissed(run);
        const changes = onServerChange(() => void engine.sync());
        const fallback = onNudgeDone(() => {
            const day = todayKey();
            if (dismissAlarmsFor(day)) {
                run();
                return;
            }
            // No native side to hold it (iOS): sent once, as the press was.
            void trpcClient.reminder.dismissToday.mutate({ date: day }).then(rearm, () => undefined);
        });

        return () => {
            foreground.remove();
            pressed();
            fallback();
            changes();
            engine.stop();
            sync.current = null;
        };
    }, [rearm]);

    useEffect(() => {
        if (settingsFetchedAt > 0) sync.current?.settle(settingsFetchedAt);
    }, [settingsFetchedAt]);

    return current;
}

/** Whether today's nudge is off: dismissed on the server, or by this phone's press on its way there. */
export function useRemindersOffToday(): boolean {
    const trpc = useTRPC();
    const settings = useQuery(trpc.settings.get.queryOptions());
    const current = useSyncExternalStore(subscribe, readHeld);
    const today = todayKey();
    return effectiveDismissedOn(settings.data?.reminderDismissedOn ?? null, current, today) === today;
}
