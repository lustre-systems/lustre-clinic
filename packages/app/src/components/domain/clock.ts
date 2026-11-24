import {
    minutesOfDay as clinicMinutesOfDay,
    secondsOfDay as clinicSecondsOfDay,
    type Locale,
    localizeCopy,
} from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';

export interface Clock12 {
    time: string;
    meridiem: string;
}

export const DAY_MINUTES = 24 * 60;

const MERIDIEM: Record<Locale, { am: string; pm: string }> = {
    en: { am: 'AM', pm: 'PM' },
    ar: { am: 'ص', pm: 'م' },
};

function pad(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

export function minutesOfDay(at: string | number): number {
    return clinicMinutesOfDay(at);
}

export function secondsOfDay(at: string | number): number {
    return clinicSecondsOfDay(at);
}

export function clock12(minutes: number, locale: Locale = getLocale()): Clock12 {
    const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const hours = Math.floor(wrapped / 60);
    const marker = MERIDIEM[locale];

    return {
        time: `${hours % 12 === 0 ? 12 : hours % 12}:${pad(wrapped % 60)}`,
        meridiem: hours < 12 ? marker.am : marker.pm,
    };
}

export function time12(iso: string, locale: Locale = getLocale()): Clock12 {
    return clock12(minutesOfDay(iso), locale);
}

export function formatClock12(minutes: number, locale: Locale = getLocale()): string {
    const { time, meridiem } = clock12(minutes, locale);
    return `${time} ${meridiem}`;
}

export function formatTime12(iso: string, locale: Locale = getLocale()): string {
    return formatClock12(minutesOfDay(iso), locale);
}

export function formatStamp(at: number, locale: Locale = getLocale()): string {
    return formatClock12(clinicMinutesOfDay(at), locale);
}

export function formatDuration(minutes: number, locale: Locale = getLocale()): string {
    if (minutes < 60) return localizeCopy(locale, '{minutes} min', { minutes });
    return localizeCopy(locale, '{hours}h {minutes}m', {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
    });
}

export function formatElapsed(totalSeconds: number): string {
    const whole = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(whole / 3_600);
    const minutes = Math.floor((whole % 3_600) / 60);
    const seconds = whole % 60;
    const pad = (value: number) => String(value).padStart(2, '0');

    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatSpan(from: number, to: number, locale: Locale = getLocale()): string {
    return `${formatClock12(from, locale)} – ${formatClock12(to, locale)}`;
}
