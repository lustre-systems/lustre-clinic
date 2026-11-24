import { clinicNow, clinicOffsetNow, todayKey } from '@lustre/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// biome-ignore lint/style/noRestrictedImports: two of them, both external — arming the OS notification scheduler, and the `AppState` subscription that re-arms it on foreground
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api, phoneTimeOf, skewMinutes, subscribeSkew, useTRPC } from '../api';
import { useLocale } from '../i18n';
import { useReminderAlarm } from './alarmStore';
import { effectiveDismissedOn } from './dismissal';
import { armNudges } from './notifications';
import { minutesOfClock, nudgePendingInput, planNudges } from './schedule';
import { useAlarmDismissal } from './useAlarmDismissal';

export function useReminderNudges(enabled: boolean): void {
    const trpc = useTRPC();
    const rearm = useRearmReminderNudges();

    const [foregrounded, setForegrounded] = useState(0);
    const locale = useLocale();

    const settings = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
    const pending = useQuery(
        trpc.reminder.pending.queryOptions(nudgePendingInput(clinicOffsetNow()), { enabled }),
    );

    const notifyAt = settings.data?.reminderNotifyAt;
    const repeatMinutes = settings.data?.reminderRepeatMinutes;
    const dismissedOn = settings.data?.reminderDismissedOn ?? null;
    const held = useAlarmDismissal(rearm, { fetchedAt: settings.dataUpdatedAt, dismissedOn });
    const pendingCount = pending.data?.length;
    const alarm = useReminderAlarm();
    const skew = useSyncExternalStore(subscribeSkew, skewMinutes);

    // biome-ignore lint/correctness/useExhaustiveDependencies: `foregrounded`, `locale` and `skew` are triggers, not values — the arm reads the clock, the day, the OS permission and the language, none of which it is handed
    useEffect(() => {
        if (!enabled) {
            void armNudges({ at: [], silent: null }, { alarm: false, day: todayKey() });
            return;
        }
        if (
            notifyAt === undefined ||
            repeatMinutes === undefined ||
            pendingCount === undefined ||
            !alarm.hydrated
        ) {
            return;
        }

        const now = clinicNow();
        const today = todayKey(now);
        const plan = planNudges({
            notifyAt: minutesOfClock(notifyAt),
            repeatMinutes,
            pendingCount,
            dismissedOn: effectiveDismissedOn(dismissedOn, held, today),
            today,
            now,
        });
        void armNudges(
            { ...plan, at: plan.at.map((at) => new Date(phoneTimeOf(at.getTime()))) },
            { alarm: alarm.enabled, day: today },
        );
    }, [
        enabled,
        notifyAt,
        repeatMinutes,
        dismissedOn,
        held,
        pendingCount,
        foregrounded,
        locale,
        alarm.hydrated,
        alarm.enabled,
        skew,
    ]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;
            rearm();
            setForegrounded((n) => n + 1);
        });
        return () => subscription.remove();
    }, [rearm]);
}

export function useRearmReminderNudges(): () => void {
    const client = useQueryClient();

    return useCallback(() => {
        void client.invalidateQueries(api.reminder.pathFilter());
        void client.invalidateQueries(api.settings.pathFilter());
    }, [client]);
}
