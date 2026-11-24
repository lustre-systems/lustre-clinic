import { requireOptionalNativeModule } from 'expo';

export interface AlarmCopy {
    title: string;
    body: string;
    done: string;
    open: string;
    channelName: string;
}

export interface AlarmCheck {
    bases: string[];
    pendingPath: string;
    settingsPath: string;
    today: string;
}

export interface AlarmDismissal {
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

export function tryAlarm(ms: number, day: string, copy: AlarmCopy): boolean {
    return native?.tryIn(ms, day, copy) ?? false;
}

export function dismissAlarmsFor(day: string): void {
    native?.dismiss(day);
}

export function alarmDismissal(): AlarmDismissal | null {
    return native?.dismissal() ?? null;
}

export function alarmDismissalSent(day: string): void {
    native?.dismissalSent(day);
}

export function clearAlarmDismissal(): void {
    native?.clearDismissal();
}

export function onAlarmDismissed(listener: () => void): () => void {
    const subscription = native?.addListener('onDone', listener);
    return () => subscription?.remove();
}

export function cancelAlarms(): void {
    native?.cancel();
}

export function takeOpenRequest(): boolean {
    return native?.takeOpenRequest() ?? false;
}

export function canTakeOverLockScreen(): boolean {
    return native?.canFullScreen() ?? false;
}

export function openLockScreenSettings(): void {
    native?.openFullScreenSettings();
}
