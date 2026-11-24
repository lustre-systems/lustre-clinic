import {
    addDays,
    addMonths,
    clinicOffsetNow,
    dateKey,
    isoAt,
    keyParts,
    localizeCopy,
    monthDays,
    offsetForDate,
    weekdayOf,
} from '@lustre/shared';
import { serverToday } from '../../api/serverClock';
import { getLocale } from '../../i18n/runtime';

export {
    clock12,
    formatClock12,
    formatDuration,
    formatElapsed,
    formatSpan,
    formatTime12,
    minutesOfDay,
    secondsOfDay,
    time12,
} from '../../components/domain/clock';

export {
    addDays,
    addMonths,
    clinicOffsetNow,
    dateKey,
    isoAt,
    keyParts,
    monthDays,
    offsetForDate,
    serverToday as todayKey,
    weekdayOf,
};

export function clockToMinutes(clock: string): number {
    const [hours = 0, minutes = 0] = clock.split(':').map(Number);
    return hours * 60 + minutes;
}

export function dayOfMonth(key: string): number {
    return keyParts(key).day;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;
const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
] as const;

export function weekdayName(weekday: number): string {
    return WEEKDAYS[weekday] ?? '';
}

function say(copy: string): string {
    return localizeCopy(getLocale(), copy);
}

export function formatLongDate(key: string): string {
    const date = keyParts(key);
    return `${say(WEEKDAYS[date.weekday] ?? '')}, ${date.day} ${say(MONTHS[date.month - 1] ?? '')} ${date.year}`;
}

export function formatDate(key: string): string {
    const date = keyParts(key);
    return `${say(WEEKDAYS_SHORT[date.weekday] ?? '')} ${date.day} ${say(MONTHS_SHORT[date.month - 1] ?? '')}`;
}

export function formatDatePill(key: string, today: string = serverToday()): string {
    const date = keyParts(key);
    const month = MONTHS_SHORT[date.month - 1] ?? '';
    const stamp = `${date.day} ${getLocale() === 'ar' ? say(month) : month.toUpperCase()}`;
    if (key === today) return stamp;
    const weekday = WEEKDAYS_SHORT[date.weekday] ?? '';
    return `${getLocale() === 'ar' ? say(weekday) : weekday.toUpperCase()} ${stamp}`;
}

export function monthShort(key: string): string {
    return say(MONTHS_SHORT[keyParts(key).month - 1] ?? '');
}

export function formatMonth(key: string): string {
    const date = keyParts(key);
    return `${say(MONTHS_SHORT[date.month - 1] ?? '')} ${date.year}`;
}

export function relativeDayLabel(key: string, today: string = serverToday()): string {
    if (key === today) return say('Today');
    if (key === addDays(today, 1)) return say('Tomorrow');
    if (key === addDays(today, -1)) return say('Yesterday');
    return formatDate(key);
}
