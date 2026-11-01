/**
 * The reminder template's one token syntax, and the one substitution that
 * renders it (§11).
 *
 * This render lived in three places — the server sender, the demo sender and
 * the settings preview — and the three had drifted apart: the pane offered
 * `{name}` while both senders only ever substituted `{{name}}`, so a template
 * built from the chips reached the patient with the placeholder still in it.
 * One copy, imported by all three, is what stops a chip offering a token
 * nothing substitutes.
 *
 * `{{name}}` is the written form: it is what the chips insert, what the
 * seeded default carries, and what the preview renders. `{name}` is still
 * substituted on the way out because templates built from the old chips are
 * already saved in clinic databases, and a message that regressed to literal
 * braces on deploy is this same bug seen from the other side. Nothing offers
 * or writes the single-brace form.
 *
 * An unrecognized placeholder is left visible in either syntax, so a typo
 * shows rather than vanishing.
 */
import { callerWallClock, clinicDayOf } from './clinicTime.ts';
import { REMINDER_PLACEHOLDERS, type ReminderPlaceholder } from './constants.ts';

/** `'name'` → `'{{name}}'`. The form the pane inserts and the preview reads. */
export function reminderToken(placeholder: ReminderPlaceholder): string {
    return `{{${placeholder}}}`;
}

/** Every supported token, in the order the settings pane draws its chips. */
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

/**
 * The latest `dueAt` that `reminder.pending`'s `dueOnly` list includes, used by
 * the server and the demo alike. Before the clinic's notify time it is `now`.
 * From the notify time on, or with `throughToday`, it is the end of the clinic's
 * local day: a reminder is due `reminderLeadHours` before its appointment, so at
 * a 17:00 notify time with a 24 h lead tomorrow's evening patients are not due
 * yet, and the alarm brought them up one per repeat as each crossed the line.
 *
 * `notifyAt` is `HH:MM` (or `HH:MM:SS`) in clinic local time; `offsetMinutes` is
 * the client's UTC offset now, which is what places `now` in the clinic's day
 * (`callerWallClock`).
 */
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

/**
 * The reminder lead as the settings show it: whole days before the
 * appointment. The column stays in hours (`reminderLeadHours`), written as
 * days × 24, so the server and the due times it computes do not change. A lead
 * set in hours by an older build reads as the nearest day, never below one.
 */
export const REMINDER_LEAD_MAX_DAYS = 7;

export function leadDaysOf(hours: number): number {
    return Math.min(REMINDER_LEAD_MAX_DAYS, Math.max(1, Math.round(hours / 24)));
}

export function leadHoursOf(days: number): number {
    return days * 24;
}
