import { callerWallClock, clinicDayOf } from './clinicTime.ts';
import { REMINDER_PLACEHOLDERS, type ReminderPlaceholder } from './constants.ts';

export function reminderToken(placeholder: ReminderPlaceholder): string {
    return `{{${placeholder}}}`;
}

export const REMINDER_TOKENS: readonly string[] = REMINDER_PLACEHOLDERS.map(reminderToken);

export function renderReminderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(
        /\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g,
        (whole, double: string | undefined, single: string | undefined) => {
            const key = double ?? single;
            return key !== undefined && (REMINDER_PLACEHOLDERS as readonly string[]).includes(key)
                ? (values[key] ?? whole)
                : whole;
        },
    );
}

export function reminderDueCutoff(input: {
    now: Date;
    notifyAt: string;
    offsetMinutes: number;
    throughToday?: boolean;
}): Date {
    const { now, offsetMinutes } = input;
    const [hours = 0, minutes = 0] = input.notifyAt.split(':').map(Number);

    const wall = callerWallClock(now, offsetMinutes, now.getTime());
    if (!input.throughToday && wall.minutes < hours * 60 + minutes) return now;

    return new Date(clinicDayOf(now, offsetMinutes, now.getTime()).to.getTime() - 1);
}

export const REMINDER_LEAD_MAX_DAYS = 7;

export function leadDaysOf(hours: number): number {
    return Math.min(REMINDER_LEAD_MAX_DAYS, Math.max(1, Math.round(hours / 24)));
}

export function leadHoursOf(days: number): number {
    return days * 24;
}
