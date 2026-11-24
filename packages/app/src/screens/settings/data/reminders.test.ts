import { describe, expect, test } from 'bun:test';
import { DEFAULT_REMINDER_TEMPLATE, REMINDER_TOKENS, reminderToken } from '@lustre/shared';
import { previewMessage } from './reminders';

describe('previewMessage', () => {
    test('renders the seeded default with no braces left', () => {
        const preview = previewMessage(DEFAULT_REMINDER_TEMPLATE);

        expect(preview).toBe(
            'Hello Nour El-Sayed, this is a reminder of your appointment at Nile Clinic on 2026-06-12 at 11:35.',
        );
    });

    test('shows the time chip as the time the sender writes', () => {
        expect(previewMessage(`See you at ${reminderToken('time')}.`)).toBe('See you at 11:35.');
    });

    test('resolves every chip the pane offers', () => {
        expect(previewMessage(REMINDER_TOKENS.join(' '))).not.toMatch(/[{}]/);
    });

    test('reads a template saved from the old chips the way the sender does', () => {
        expect(previewMessage('See you at {time} in {branch}.')).toBe('See you at 11:35 in Heliopolis.');
    });

    test('leaves a mistyped token visible so it can be caught before saving', () => {
        expect(previewMessage('See you at {{tiem}}.')).toBe('See you at {{tiem}}.');
    });
});
