/**
 * The `expo-notifications` side of the daily reminder nudge — permission, the
 * Android channel, and arming the instants [`schedule.ts`](./schedule.ts)
 * works out. Nothing here decides *when*; that is the rule, and the rule is
 * tested.
 *
 * **Local, not push** (SPEC §11, and the reason it is worth writing down). A
 * server push needs a device registry and a push service, which is a lot of new
 * machinery for one notification and is dead exactly when the clinic PC is off —
 * a power cut is when the desk most needs to be told the list is still there.
 * The pane already frames the two settings as being about this phone ("Notify me
 * at", not "notify the clinic"), so each user is nudged about their own list.
 *
 * **The body carries no count.** A nudge is armed hours before it fires and the
 * list can move on the other phone in between, so "3 reminders" would go stale
 * into a wrong number. "Reminders are waiting" is true whenever any are pending
 * and cannot be wrong by one.
 *
 * **Never any patient data** (§17): no name, no phone, no ref. A notification
 * shows on a lock screen in a waiting room. The one exception is the desk's
 * "coming to the desk" notice below, which is useless without a name — it
 * carries the name and nothing else, on a channel the lock screen hides.
 *
 * Arming is always cancel-then-schedule over this one channel, never a diff. The
 * plan is cheap to recompute and a diff is how a phone ends up with two series
 * layered over each other, each buzzing on its own half-hour.
 */
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

/** Tags every nudge this module owns, so cancelling never touches a notification someone else scheduled. */
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

/**
 * Android needs a channel before anything can be posted to it, and the channel
 * is what the user tunes in system settings — so it is named for what it is
 * rather than for the app, and named again when the app's language changes:
 * creating a channel under an id that exists only renames it, so the user's
 * own settings for it survive. Every channel below follows the same rule.
 */
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

/**
 * Asked for on the first arm — which, because the shell arms as soon as the two
 * queries answer, is a few seconds into the first launch. That is deliberate
 * rather than ideal: the alternative is arming nothing until someone visits
 * Settings → Reminders, and the 19:00 default is meant to work without anyone
 * going looking for it.
 *
 * A denial is final for the session. Re-asking every foreground is what teaches
 * someone to swat the prompt away, and Android stops showing it anyway. The way
 * back is Settings → Reminders, which says the OS is blocking it.
 */
let asking: Promise<boolean> | null = null;

// One prompt in flight at a time: the nudge and the desk notice both ask at
// launch, and the second request would otherwise race the first dialog.
export function ensurePermission(): Promise<boolean> {
    asking ??= (async () => {
        const current = await Notifications.getPermissionsAsync();
        if (current.granted) return true;
        if (!current.canAskAgain) return false;

        // The dialog takes the app off screen; its answer must reach this app, not a restarted one.
        const asked = await withUpdatesHeld(() => Notifications.requestPermissionsAsync());
        return asked.granted;
    })().finally(() => {
        asking = null;
    });
    return asking;
}

/** Whether the OS will let a nudge through right now. Asks nothing — a read, for the pane. */
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

/**
 * Cancel what is armed and arm the plan. An empty plan is a cancel — that is the
 * whole of "stops when the list is cleared or dismissed for the day".
 *
 * On Android the plan goes to `modules/lustre-alarm`, which asks the clinic
 * server just before each one and stays quiet if the list has emptied since
 * (`alarmCheck.ts`). With `alarm` each one rings until stopped and fills the
 * lock screen; without, it is a plain notification. `expo-notifications` is
 * only the fallback — iOS, or Android refusing an exact alarm — and cannot
 * check, because it posts without waking any code. Only one of the two is ever
 * armed, and emptying the plan also stops a ring that is going: the list was
 * cleared.
 *
 * Returns what it did, so the caller can hold "notifications are off" without
 * this module reaching for a logger the app does not have. Nothing in
 * `packages/app` writes to a console, and a nudge that did not arm is a thing to
 * say on screen rather than into a log nobody reads.
 *
 * One arm at a time. The effect can ask again — the alarm switch flipped, a
 * refetch landed — while the last arm is still between its cancel and its
 * schedule, and two arms interleaved that way each cancel before either
 * schedules, which leaves both series armed.
 */
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
    // The ring's screen and its Done for today both hang off its notification:
    // no notifications, no way to stop it.
    if (!(await ensurePermission())) {
        cancelAlarms();
        return 'refused';
    }

    // The plain nudge posts on this channel from native code too.
    if (!alarm) await ensureChannel();
    if (scheduleAlarms(plan.at, day, alarmCopy(), serverCheck(day), alarm)) return 'armed';
    // No native side, or Android refused the exact alarm: the ordinary nudge,
    // unchecked, rather than none.
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

/**
 * Done for today on the fallback nudge. It brings the app up, because nothing
 * else runs code for a notification `expo-notifications` posted: with the app
 * killed, an action that stays in the background is never heard.
 */
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

/**
 * Calls `listener` when Done for today is pressed on a fallback nudge, including
 * the press that launched the app.
 */
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

/**
 * Demo mode's "Try the alarm": one real ring `ms` from now, long enough to lock
 * the phone and see it fill the lock screen. Beside the day's series, not in it.
 */
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

/** Worded now, in the app's language: the ring comes up with no JS running to word it. */
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

/**
 * High importance, so it drops down over whatever she is doing: the patient is
 * walking to the desk now. Private, so a locked phone says a notification
 * arrived and not whose.
 */
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

/**
 * Posts "the doctor is finished with {name}" now. `name` is null when it could
 * not be fetched — the clinic answered the socket and not the request — and the
 * notice still goes, without it: telling her someone is coming is the point.
 */
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

/**
 * The doctor's Finish did not reach the clinic. It names nobody — the ongoing
 * notice above it still shows who is in the chair, with the button back on it.
 */
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

/** High importance and private, like the desk's: someone is waiting now, and a locked phone says so without saying who. */
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

/** Posts "{name} has checked in" on the doctor's phone. `name` is null when it could not be fetched, and the notice still goes. */
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
