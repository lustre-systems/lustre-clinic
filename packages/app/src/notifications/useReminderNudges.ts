/**
 * Keeps the daily nudge armed against what the server currently says. The
 * settings pane has written `reminder_notify_at` and `reminder_repeat_minutes`
 * since the cluster came off fixtures; this is the thing that finally reads them.
 *
 * One arm path, and everything else feeds it — the effect below is the only
 * caller of `armNudges`. A second path is how a phone ends up with two series
 * layered over each other, each buzzing on its own half-hour.
 *
 * The effect is the one place an effect is right: arming an OS alarm is a side
 * effect on a thing outside React, off state React owns, and there is nothing to
 * derive.
 *
 * **Foreground is the important trigger**, and it feeds the effect twice over.
 * It invalidates the two queries, because a phone that was asleep heard nothing
 * about what the other phone did. It also bumps a counter *in the effect's
 * dependencies*, because three of the arm's inputs are not in those answers at
 * all — whether the OS still refuses notifications, what the wall clock says,
 * and which day it is. Invalidation alone would leave the nudge unarmed for a
 * user who turned notifications on in Android settings and came back, and for a
 * process that was alive at midnight.
 */

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

/**
 * `enabled` is the desk's phone: reminders are the secretary's job, and the
 * doctor's and the admin's phones never nudge. Turned off, anything already
 * armed on this phone is cancelled.
 */
export function useReminderNudges(enabled: boolean): void {
    const trpc = useTRPC();
    const rearm = useRearmReminderNudges();

    // Foregrounding has to re-run the arm itself, not only ask for fresh data.
    // Three of the inputs are not in the query answers at all: whether the OS
    // still refuses notifications, what the wall clock says, and which day it
    // is. A refetch that comes back identical moves no dependency, and the two
    // states that follow from that are exactly the ones the design names — a
    // user who denied the prompt, turned notifications on in Android settings
    // and came back, and a process that was alive at midnight and needs the new
    // day's series.
    const [foregrounded, setForegrounded] = useState(0);
    // The nudge is worded when it is armed, so a language switch re-arms it.
    const locale = useLocale();

    const settings = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
    const pending = useQuery(
        trpc.reminder.pending.queryOptions(nudgePendingInput(clinicOffsetNow()), { enabled }),
    );

    const notifyAt = settings.data?.reminderNotifyAt;
    const repeatMinutes = settings.data?.reminderRepeatMinutes;
    const dismissedOn = settings.data?.reminderDismissedOn ?? null;
    // Done for today pressed on the ring, until the server has it and says so.
    const held = useAlarmDismissal(rearm, { fetchedAt: settings.dataUpdatedAt, dismissedOn });
    const pendingCount = pending.data?.length;
    const alarm = useReminderAlarm();
    // The alarms are armed on the phone's clock, so a newly measured skew,
    // usually the first one after launch, moves every one of them.
    const skew = useSyncExternalStore(subscribeSkew, skewMinutes);

    // biome-ignore lint/correctness/useExhaustiveDependencies: `foregrounded`, `locale` and `skew` are triggers, not values — the arm reads the clock, the day, the OS permission and the language, none of which it is handed
    useEffect(() => {
        if (!enabled) {
            void armNudges({ at: [], silent: null }, { alarm: false, day: todayKey() });
            return;
        }
        // Nothing is armed and nothing is cancelled until both answers are in.
        // Disarming on a missing answer would silence the nudge every time the
        // clinic PC is briefly unreachable, which is when it matters most.
        if (
            notifyAt === undefined ||
            repeatMinutes === undefined ||
            pendingCount === undefined ||
            !alarm.hydrated
        ) {
            return;
        }

        // Planned on the clinic's clock, armed on the phone's: the OS fires by it.
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

/**
 * Re-read what the nudge is armed against. For the actions that change the list
 * from inside this app — a reminder marked sent or skipped, a day dismissed —
 * which go over the raw tRPC client and so leave the query cache untouched.
 *
 * Stable across renders, because the effect above holds it in a dependency list:
 * a fresh identity every render would tear down and re-add the `AppState`
 * listener on every one of them.
 */
export function useRearmReminderNudges(): () => void {
    const client = useQueryClient();

    return useCallback(() => {
        void client.invalidateQueries(api.reminder.pathFilter());
        void client.invalidateQueries(api.settings.pathFilter());
    }, [client]);
}
