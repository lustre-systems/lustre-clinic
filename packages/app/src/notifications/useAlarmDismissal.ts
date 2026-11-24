import { todayKey } from '@lustre/shared';
import { useQuery } from '@tanstack/react-query';
// biome-ignore lint/style/noRestrictedImports: subscribes to the native Done press, `AppState` and `/ws`, and runs the retry timer
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
    type AlarmDismissal,
    alarmDismissal,
    alarmDismissalSent,
    alarmsAvailable,
    clearAlarmDismissal,
    dismissAlarmsFor,
    onAlarmDismissed,
} from '../../modules/lustre-alarm';
import { onServerChange, trpcClient, useTRPC } from '../api';
import { createDismissalSync, effectiveDismissedOn } from './dismissal';
import { onNudgeDone } from './notifications';

const RETRY_MS = 60_000;

let unheld: AlarmDismissal | null = null;
const hold = alarmsAvailable
    ? {
          read: alarmDismissal,
          press: dismissAlarmsFor,
          markSent: alarmDismissalSent,
          clear: clearAlarmDismissal,
      }
    : {
          read: () => unheld,
          press: (day: string) => {
              unheld = { day, sent: false };
          },
          markSent: (day: string) => {
              if (unheld?.day === day) unheld = { day, sent: true };
          },
          clear: () => {
              unheld = null;
          },
      };

const listeners = new Set<() => void>();
let held: AlarmDismissal | null | undefined;

function readHeld(): AlarmDismissal | null {
    if (held === undefined) held = hold.read();
    return held;
}

function reread(): void {
    const next = hold.read();
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

export function forgetAlarmDismissal(): void {
    hold.clear();
    reread();
}

export function useAlarmDismissal(
    rearm: () => void,
    settings: { fetchedAt: number; dismissedOn: string | null },
): AlarmDismissal | null {
    const current = useSyncExternalStore(subscribe, readHeld);
    const sync = useRef<ReturnType<typeof createDismissalSync> | null>(null);

    useEffect(() => {
        const engine = createDismissalSync({
            read: hold.read,
            send: (date) => trpcClient.reminder.dismissToday.mutate({ date }),
            markSent: hold.markSent,
            clear: hold.clear,
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
            hold.press(todayKey());
            run();
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

    const { fetchedAt, dismissedOn } = settings;
    useEffect(() => {
        if (fetchedAt > 0) sync.current?.settle(fetchedAt, dismissedOn);
    }, [fetchedAt, dismissedOn]);

    return current;
}

export function useRemindersOffToday(): boolean {
    const trpc = useTRPC();
    const settings = useQuery(trpc.settings.get.queryOptions());
    const current = useSyncExternalStore(subscribe, readHeld);
    const today = todayKey();
    return effectiveDismissedOn(settings.data?.reminderDismissedOn ?? null, current, today) === today;
}
