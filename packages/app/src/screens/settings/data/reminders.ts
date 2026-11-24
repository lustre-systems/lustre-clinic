import { type ReminderPlaceholder, renderReminderTemplate } from '@lustre/shared';

export const TEMPLATE_MAX = 320;

const DAY_MINUTES = 24 * 60;

export function minutesFromTime(time: string): number {
    const [hours, minutes] = time.split(':');
    const total = Number(hours) * 60 + Number(minutes);
    return Number.isFinite(total) ? Math.min(Math.max(total, 0), DAY_MINUTES - 1) : 0;
}

export function timeFromMinutes(minutes: number): string {
    const wrapped = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}`;
}

export interface TemplateDraft {
    text: string;
    dirty: boolean;
    issue: string | null;
    canSave: boolean;
}

export function templateDraft(draft: string | null, saved: string | undefined): TemplateDraft {
    const text = draft ?? saved ?? '';
    const over = text.length - TEMPLATE_MAX;

    const issue =
        over > 0
            ? `Too long by ${over} ${over === 1 ? 'character' : 'characters'}. The message has to fit ${TEMPLATE_MAX}.`
            : text.trim() === ''
              ? 'The message cannot be empty.'
              : null;

    const dirty = draft !== null && draft.trim() !== (saved ?? '').trim();

    return { text, dirty, issue, canSave: dirty && issue === null };
}

const SAMPLE: Record<ReminderPlaceholder, string> = {
    name: 'Nour El-Sayed',
    date: '2026-06-12',
    time: '11:35',
    branch: 'Heliopolis',
    clinic: 'Nile Clinic',
    ref: '120626-K7T4',
};

export function previewMessage(template: string): string {
    return renderReminderTemplate(template, SAMPLE);
}
