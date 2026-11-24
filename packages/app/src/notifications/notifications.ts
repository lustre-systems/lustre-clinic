import { clinicOffsetNow, type Locale, localizeCopy, todayKey } from '@lustre/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
    type AlarmCheck,
    type AlarmCopy,
    cancelAlarms,
    scheduleAlarms,
    tryAlarm,
} from '../../modules/lustre-alarm';
import { getConnectionState, isDemoMode, isLocalMode, serverAddresses } from '../api';
import { getLocale } from '../i18n/runtime';
import { withUpdatesHeld } from '../shell/updateGate';
import { alarmCheck } from './alarmCheck';
import type { NudgePlan } from './schedule';
import { failureIdentifier } from './visitAction';
import { arrivalIdentifier, noticeIdentifier } from './visitNotice';

const CHANNEL_ID = 'reminders';

const NUDGE_TAG = 'lustre.reminder.nudge';

const NUDGE_CATEGORY = 'lustre.reminder.nudge';
const DONE_ACTION = 'done';

const TITLE = 'Reminders pending';
const BODY = 'Reminders are waiting to be sent.';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

let channelLocale: Locale | null = null;

async function ensureChannel(): Promise<void> {
    if (Platform.OS !== 'android' || channelLocale === getLocale()) return;

    const t = (copy: string) => localizeCopy(getLocale(), copy);
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: t('Appointment reminders'),
        description: t('The daily nudge that reminders are still waiting to be sent.'),
        importance: Notifications.AndroidImportance.DEFAULT,
    });
    channelLocale = getLocale();
}

let asking: Promise<boolean> | null = null;

export function ensurePermission(): Promise<boolean> {
    asking ??= (async () => {
        const current = await Notifications.getPermissionsAsync();
        if (current.granted) return true;
        if (!current.canAskAgain) return false;

        const asked = await withUpdatesHeld(() => Notifications.requestPermissionsAsync());
        return asked.granted;
    })().finally(() => {
        asking = null;
    });
    return asking;
}

export async function notificationsAllowed(): Promise<boolean> {
    return (await Notifications.getPermissionsAsync()).granted;
}

async function cancelNudges(): Promise<void> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();

    await Promise.all(
        scheduled
            .filter((notification) => notification.content.data?.tag === NUDGE_TAG)
            .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
    );
}

export function armNudges(
    plan: NudgePlan,
    { alarm, day }: { alarm: boolean; day: string },
): Promise<ArmResult> {
    const next = arming.then(() => arm(plan, alarm, day));
    arming = next.catch(() => undefined);
    return next;
}

type ArmResult = 'armed' | 'disarmed' | 'refused';

let arming: Promise<unknown> = Promise.resolve();

async function arm(plan: NudgePlan, alarm: boolean, day: string): Promise<ArmResult> {
    await cancelNudges();

    if (plan.at.length === 0) {
        cancelAlarms();
        return 'disarmed';
    }
    if (!(await ensurePermission())) {
        cancelAlarms();
        return 'refused';
    }

    if (!alarm) await ensureChannel();
    if (scheduleAlarms(plan.at, day, alarmCopy(), serverCheck(day), alarm)) return 'armed';
    cancelAlarms();
    await ensureChannel();
    await ensureNudgeCategory();

    for (const at of plan.at) {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: localizeCopy(getLocale(), TITLE),
                body: localizeCopy(getLocale(), BODY),
                data: { tag: NUDGE_TAG },
                categoryIdentifier: NUDGE_CATEGORY,
            },
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: at,
                channelId: CHANNEL_ID,
            },
        });
    }

    return 'armed';
}

let categoryLocale: Locale | null = null;

async function ensureNudgeCategory(): Promise<void> {
    if (categoryLocale === getLocale()) return;
    await Notifications.setNotificationCategoryAsync(NUDGE_CATEGORY, [
        {
            identifier: DONE_ACTION,
            buttonTitle: localizeCopy(getLocale(), 'Done for today'),
            options: { opensAppToForeground: true },
        },
    ]);
    categoryLocale = getLocale();
}

export function onNudgeDone(listener: () => void): () => void {
    const handle = (response: Notifications.NotificationResponse | null) => {
        if (response?.actionIdentifier !== DONE_ACTION) return;
        if (response.notification.request.content.data?.tag !== NUDGE_TAG) return;
        Notifications.clearLastNotificationResponse();
        listener();
    };
    handle(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    return () => subscription.remove();
}

export async function tryReminderAlarm(ms: number): Promise<boolean> {
    if (!(await ensurePermission())) return false;
    return tryAlarm(ms, todayKey(), alarmCopy());
}

function serverCheck(today: string): AlarmCheck | null {
    const { lan, tailscale } = serverAddresses();
    return alarmCheck({
        demo: isDemoMode() || isLocalMode(),
        current: getConnectionState().baseUrl,
        lan,
        tailscale,
        today,
        offsetMinutes: clinicOffsetNow(),
    });
}

function alarmCopy(): AlarmCopy {
    const t = (copy: string) => localizeCopy(getLocale(), copy);
    return {
        title: t(TITLE),
        body: t(BODY),
        done: t('Done for today'),
        open: t('Open reminders'),
        channelName: t('Appointment reminders (ringing)'),
    };
}

const VISIT_CHANNEL_ID = 'visits';

let visitChannelLocale: Locale | null = null;

async function ensureVisitChannel(): Promise<void> {
    if (Platform.OS !== 'android' || visitChannelLocale === getLocale()) return;

    const t = (copy: string) => localizeCopy(getLocale(), copy);
    await Notifications.setNotificationChannelAsync(VISIT_CHANNEL_ID, {
        name: t('Patients coming to the desk'),
        description: t('When the doctor finishes with a patient.'),
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    visitChannelLocale = getLocale();
}

export async function presentVisitNotice(appointmentId: string, name: string | null): Promise<void> {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await ensureVisitChannel();

    const locale = getLocale();
    await Notifications.scheduleNotificationAsync({
        identifier: noticeIdentifier(appointmentId),
        content: {
            title: name
                ? localizeCopy(locale, '{name} is coming to the desk', { name })
                : localizeCopy(locale, 'A patient is coming to the desk'),
            body: localizeCopy(locale, 'The doctor is finished. Ready for checkout.'),
        },
        trigger: Platform.OS === 'android' ? { channelId: VISIT_CHANNEL_ID } : null,
    });
}

const FINISH_CHANNEL_ID = 'visit-finish';

let finishChannelLocale: Locale | null = null;

async function ensureFinishChannel(): Promise<void> {
    if (Platform.OS !== 'android' || finishChannelLocale === getLocale()) return;

    const t = (copy: string) => localizeCopy(getLocale(), copy);
    await Notifications.setNotificationChannelAsync(FINISH_CHANNEL_ID, {
        name: t('Visits not finished'),
        description: t('When finishing a visit from the notification does not go through.'),
        importance: Notifications.AndroidImportance.HIGH,
    });
    finishChannelLocale = getLocale();
}

export async function presentFinishFailure(appointmentId: string, offline: boolean): Promise<void> {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await ensureFinishChannel();

    const locale = getLocale();
    await Notifications.scheduleNotificationAsync({
        identifier: failureIdentifier(appointmentId),
        content: {
            title: localizeCopy(locale, 'The visit was not finished'),
            body: offline
                ? localizeCopy(locale, "Can't reach the clinic server. Try again.")
                : localizeCopy(locale, 'Something went wrong. Try again, or finish it in the app.'),
        },
        trigger: Platform.OS === 'android' ? { channelId: FINISH_CHANNEL_ID } : null,
    });
}

export async function dismissFinishFailure(appointmentId: string): Promise<void> {
    await Notifications.dismissNotificationAsync(failureIdentifier(appointmentId));
}

const ARRIVAL_CHANNEL_ID = 'arrivals';

let arrivalChannelLocale: Locale | null = null;

async function ensureArrivalChannel(): Promise<void> {
    if (Platform.OS !== 'android' || arrivalChannelLocale === getLocale()) return;

    const t = (copy: string) => localizeCopy(getLocale(), copy);
    await Notifications.setNotificationChannelAsync(ARRIVAL_CHANNEL_ID, {
        name: t('Patients checked in'),
        description: t('When the desk checks a patient in.'),
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    arrivalChannelLocale = getLocale();
}

export async function presentArrivalNotice(appointmentId: string, name: string | null): Promise<void> {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await ensureArrivalChannel();

    const locale = getLocale();
    await Notifications.scheduleNotificationAsync({
        identifier: arrivalIdentifier(appointmentId),
        content: {
            title: name
                ? localizeCopy(locale, '{name} has checked in', { name })
                : localizeCopy(locale, 'A patient has checked in'),
            body: localizeCopy(locale, 'They are waiting to be seen.'),
        },
        trigger: Platform.OS === 'android' ? { channelId: ARRIVAL_CHANNEL_ID } : null,
    });
}
