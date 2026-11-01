import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
    clinicOffsetNow,
    offsetAt,
    REMINDER_PLACEHOLDERS,
    REMINDER_TOKENS,
    reminderToken,
    renderReminderTemplate,
} from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { clinic as fixtures, slot } from './helpers/factories.ts';

/**
 * §11 — the settings pane offered token chips in single braces while both
 * senders only ever substituted double, so a template built by tapping the
 * chips was sent to a patient with `{name}` still in it. The chips, the
 * preview and the senders now share one list and one render, and this file is
 * what holds them to it: a token the pane can insert that the sender does not
 * substitute is a message a clinic sends with braces in it.
 *
 * The time token gets its own assertions in both `message` and the decoded
 * `whatsAppUrl`, because the device report that reopened this was about
 * `{time}` reaching WhatsApp unsubstituted, and the URL is the half a server
 * test would otherwise never look at.
 */

const VALUES: Record<string, string> = {
    name: 'Nadia Hassan',
    date: '2026-06-12',
    time: '11:35',
    branch: 'Heliopolis',
    clinic: 'Nile Clinic',
    ref: '120626-K7T4',
};

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('the reminder token syntax', () => {
    test('every chip the pane offers is a placeholder the sender substitutes', () => {
        expect(REMINDER_TOKENS).toEqual(REMINDER_PLACEHOLDERS.map((name) => `{{${name}}}`));
    });

    test('each token renders to its value, leaving no braces behind', () => {
        for (const placeholder of REMINDER_PLACEHOLDERS) {
            const rendered = renderReminderTemplate(reminderToken(placeholder), VALUES);

            expect(rendered).toBe(VALUES[placeholder] as string);
            expect(rendered).not.toMatch(/[{}]/);
        }
    });

    test('tolerates the spacing a person types inside the braces', () => {
        expect(renderReminderTemplate('at {{ time }}', VALUES)).toBe('at 11:35');
    });

    test('leaves an unknown placeholder visible in either syntax', () => {
        expect(renderReminderTemplate('Hi {{name}}, {{nonsense}} {nonsense}', VALUES)).toBe(
            'Hi Nadia Hassan, {{nonsense}} {nonsense}',
        );
    });

    // Templates built from the old chips are already saved in clinic
    // databases. Substituting them is what stops a deploy turning a message
    // that read correctly into one with braces in it.
    test('still substitutes a template saved from the old single-brace chips', () => {
        expect(renderReminderTemplate('Hello {name}, at {time} on {date}.', VALUES)).toBe(
            'Hello Nadia Hassan, at 11:35 on 2026-06-12.',
        );
    });

    test('renders a mixed template, since an old one may have been half re-typed', () => {
        expect(renderReminderTemplate('{name} — {{time}}', VALUES)).toBe('Nadia Hassan — 11:35');
    });
});

async function bookedReminder() {
    const { branch, patient } = await fixtures();
    await appointmentService.create({
        patient: { kind: 'existing', patientId: patient.id },
        branchId: branch.id,
        startsAt: slot(),
        offsetMinutes: 0,
    });

    const [reminder] = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
    if (!reminder) throw new Error('expected a pending reminder');
    return reminder;
}

describe('the sender, against what the pane can build', () => {
    test('the time chip becomes the appointment time in the message', async () => {
        await settingsService.update({ reminderTemplate: `Be here at ${reminderToken('time')}.` });

        const reminder = await bookedReminder();

        expect(reminder.message).toBe(`Be here at ${reminder.startsAt.toISOString().slice(11, 16)}.`);
        expect(reminder.message).not.toMatch(/[{}]/);
    });

    test('and the same time survives into the WhatsApp link', async () => {
        await settingsService.update({ reminderTemplate: `Be here at ${reminderToken('time')}.` });

        const reminder = await bookedReminder();
        const text = new URL(reminder.whatsAppUrl).searchParams.get('text');

        expect(text).toBe(reminder.message);
        expect(text).toContain(reminder.startsAt.toISOString().slice(11, 16));
        expect(text).not.toMatch(/[{}]/);
        // Encoded braces would decode back into the composer as braces.
        expect(reminder.whatsAppUrl).not.toContain('%7B');
    });

    // `&`, `#` and `+` would each cut the text short or turn into a space if
    // the message were put in the query unencoded, and the Arabic text and the
    // line break are what a clinic here actually writes.
    test('the WhatsApp link carries the whole message, whatever it is written in', async () => {
        await settingsService.update({
            clinicName: 'Smile & Co #1 + Kids',
            reminderTemplate: `موعدك الساعة ${reminderToken('time')}\n${reminderToken('clinic')} 100% ${reminderToken('date')}?`,
        });

        const reminder = await bookedReminder();
        const url = new URL(reminder.whatsAppUrl);
        const time = reminder.startsAt.toISOString().slice(11, 16);

        expect(url.origin + url.pathname).toMatch(/^https:\/\/wa\.me\/\d+$/);
        expect([...url.searchParams.keys()]).toEqual(['text']);
        expect(url.hash).toBe('');
        expect(url.searchParams.get('text')).toBe(reminder.message);
        expect(reminder.message).toStartWith(`موعدك الساعة ${time}\nSmile & Co #1 + Kids 100% `);
    });

    test('the time is the appointment time in the clinic day, not UTC', async () => {
        await settingsService.update({ reminderTemplate: reminderToken('time') });
        const { branch, patient } = await fixtures();
        const startsAt = slot();
        await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt,
            offsetMinutes: clinicOffsetNow(),
        });

        const [reminder] = await reminderService.pending({
            dueOnly: false,
            limit: 100,
            offsetMinutes: clinicOffsetNow(),
        });

        // 09:00 UTC is 12:00 in a Cairo summer and 11:00 in its winter.
        const clock = `${9 + offsetAt(startsAt) / 60}:00`;
        expect(reminder?.message).toBe(clock);
        expect(new URL(reminder?.whatsAppUrl ?? '').searchParams.get('text')).toBe(clock);
    });

    test('a template built from every chip leaves nothing unsubstituted', async () => {
        await settingsService.update({ reminderTemplate: REMINDER_TOKENS.join(' ') });

        const reminder = await bookedReminder();

        expect(reminder.message).not.toMatch(/[{}]/);
        expect(new URL(reminder.whatsAppUrl).searchParams.get('text')).not.toMatch(/[{}]/);
    });

    test('the branch chip names the branch the appointment is at', async () => {
        await settingsService.update({ reminderTemplate: `See you at ${reminderToken('branch')}.` });

        expect((await bookedReminder()).message).toBe('See you at Main.');
    });

    test('the ref chip quotes the appointment reference', async () => {
        await settingsService.update({ reminderTemplate: reminderToken('ref') });

        const reminder = await bookedReminder();

        expect(reminder.message).toBe(reminder.ref);
    });

    test('a template already saved in single braces does not regress on deploy', async () => {
        await settingsService.update({ reminderTemplate: 'Hello {name}, see you at {time}.' });

        const reminder = await bookedReminder();

        expect(reminder.message).toBe(
            `Hello Nadia Hassan, see you at ${reminder.startsAt.toISOString().slice(11, 16)}.`,
        );
        expect(reminder.message).not.toMatch(/[{}]/);
    });

    test('the seeded default carries no braces to a patient', async () => {
        const reminder = await bookedReminder();

        expect(reminder.message).not.toMatch(/[{}]/);
        expect(reminder.message).toContain('Nadia Hassan');
    });
});
