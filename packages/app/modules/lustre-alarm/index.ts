/**
 * The daily nudge as a real alarm (`android/`): it loops until someone stops
 * it, fills the lock screen, and is armed with `setAlarmClock`, so Doze never
 * holds it back and a reboot does not lose it. `expo-notifications` can do none
 * of that — a notification's sound plays once and stops.
 *
 * Optional, because the JS can run where it is not built in (iOS, a dev
 * client from before it): `alarmsAvailable` is false there and the nudge stays
 * an ordinary notification.
 */
import { requireOptionalNativeModule } from 'expo';

export interface AlarmCopy {
    title: string;
    body: string;
    /** Done for today: stops this ring and the rest of the day's. */
    done: string;
    open: string;
    /** What Android settings lists the ringing notification's channel as. */
    channelName: string;
}

/**
 * Asked of the clinic server just before each ring (`src/notifications/alarmCheck.ts`
 * writes it). Null rings without asking.
 */
export interface AlarmCheck {
    /** Tried in order, the one the app is on first. */
    bases: string[];
    pendingPath: string;
    settingsPath: string;
    today: string;
}

/**
 * Done for today, pressed on the ring or the plain nudge, kept on disk for JS
 * to tell the server. `sent` once it has.
 */
export interface AlarmDismissal {
    /** The clinic day, `YYYY-MM-DD`, of the series it stopped. */
    day: string;
    sent: boolean;
}

interface LustreAlarmNative {
    schedule(at: number[], day: string, copy: AlarmCopy, check: AlarmCheck | null, rings: boolean): boolean;
    tryIn(ms: number, day: string, copy: AlarmCopy): boolean;
    cancel(): void;
    dismiss(day: string): void;
    dismissal(): AlarmDismissal | null;
    dismissalSent(day: string): void;
    clearDismissal(): void;
    addListener(event: 'onDone', listener: () => void): { remove(): void };
    takeOpenRequest(): boolean;
    canFullScreen(): boolean;
    openFullScreenSettings(): void;
}

const native = requireOptionalNativeModule<LustreAlarmNative>('LustreAlarm');

export const alarmsAvailable = native !== null;

/**
 * Replaces whatever was armed. `rings` picks a ringing alarm or a plain
 * notification; either way each one asks `check` first. `day` is the clinic
 * day the series is for: once Done for today is pressed on it, it stays quiet
 * however often it is armed again. False when Android refused an exact alarm,
 * or there is no native side.
 */
export function scheduleAlarms(
    at: Date[],
    day: string,
    copy: AlarmCopy,
    check: AlarmCheck | null,
    rings: boolean,
): boolean {
    return (
        native?.schedule(
            at.map((date) => date.getTime()),
            day,
            copy,
            check,
            rings,
        ) ?? false
    );
}

/** One ring `ms` from now, beside the armed series and leaving it be. For demo mode. */
export function tryAlarm(ms: number, day: string, copy: AlarmCopy): boolean {
    return native?.tryIn(ms, day, copy) ?? false;
}

/**
 * Done for today pressed somewhere the native side did not see, the fallback
 * nudge: held and stopped the same way. False with no native side to hold it.
 */
export function dismissAlarmsFor(day: string): boolean {
    if (!native) return false;
    native.dismiss(day);
    return true;
}

/** Done for today as the native side holds it, or null when it was not pressed. */
export function alarmDismissal(): AlarmDismissal | null {
    return native?.dismissal() ?? null;
}

/** The server has `day`'s dismissal. */
export function alarmDismissalSent(day: string): void {
    native?.dismissalSent(day);
}

/** Forgets it: the server is the one to ask from here, or it was turned back on. */
export function clearAlarmDismissal(): void {
    native?.clearDismissal();
}

/** Calls `listener` when Done for today is pressed while JS is running. */
export function onAlarmDismissed(listener: () => void): () => void {
    const subscription = native?.addListener('onDone', listener);
    return () => subscription?.remove();
}

/** Disarms the series and stops a ring that is going. */
export function cancelAlarms(): void {
    native?.cancel();
}

/** Whether Open reminders was tapped since the last ask. Asking clears it. */
export function takeOpenRequest(): boolean {
    return native?.takeOpenRequest() ?? false;
}

/** Whether a ring may take over the lock screen. Android 14 lets the user switch that off. */
export function canTakeOverLockScreen(): boolean {
    return native?.canFullScreen() ?? false;
}

export function openLockScreenSettings(): void {
    native?.openFullScreenSettings();
}
