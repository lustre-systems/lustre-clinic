import { describe, expect, test } from 'bun:test';
import { instantAt } from '@lustre/shared';
import { ageInDays, backupDetails, backupView, driveSignInError, formatAge } from './data/backups';
import { patientNumberDigits, patientNumberError } from './data/clinic';
import { minutesFromTime, TEMPLATE_MAX, templateDraft, timeFromMinutes } from './data/reminders';

/**
 * The one shape the settings cluster converts rather than passes through:
 * `reminder_notify_at` is a Postgres `time` and the pane's stepper counts
 * minutes from midnight. A round trip that drifted would move the daily
 * notification every time the pane was opened and saved.
 */

describe('reminder notify time', () => {
    test('reads the column, seconds or not', () => {
        expect(minutesFromTime('00:00')).toBe(0);
        expect(minutesFromTime('06:30')).toBe(390);
        expect(minutesFromTime('19:00')).toBe(1140);
        expect(minutesFromTime('19:00:00')).toBe(1140);
        expect(minutesFromTime('23:59')).toBe(1439);
    });

    test('writes what `updateSettingsInput` accepts', () => {
        expect(timeFromMinutes(0)).toBe('00:00');
        expect(timeFromMinutes(390)).toBe('06:30');
        expect(timeFromMinutes(1140)).toBe('19:00');
        expect(timeFromMinutes(1439)).toBe('23:59');
    });

    test('survives a round trip at every step the pane can land on', () => {
        // The stepper moves in hours between 6 AM and 9 PM.
        for (let minutes = 6 * 60; minutes <= 21 * 60; minutes += 60) {
            expect(minutesFromTime(timeFromMinutes(minutes))).toBe(minutes);
        }
    });

    test('wraps rather than writing a time Postgres would refuse', () => {
        expect(timeFromMinutes(24 * 60)).toBe('00:00');
        expect(timeFromMinutes(-60)).toBe('23:00');
    });
});

/**
 * The template field used to write on blur, which on Android is a blur that
 * never arrives when the pane is left by the header or the back gesture: the
 * edit went nowhere and nothing said so. It has an explicit Save now, and what
 * that button may do is decided here.
 */
describe('the reminder template draft', () => {
    const SAVED = 'Hello {name}, see you {date} at {time}.';

    test('shows the saved message until something is typed', () => {
        const draft = templateDraft(null, SAVED);

        expect(draft.text).toBe(SAVED);
        expect(draft.dirty).toBe(false);
        expect(draft.canSave).toBe(false);
        expect(draft.issue).toBeNull();
    });

    test('offers the save once the message differs', () => {
        const draft = templateDraft('See you {date}.', SAVED);

        expect(draft.dirty).toBe(true);
        expect(draft.canSave).toBe(true);
    });

    test('does not offer a save that would write the message back unchanged', () => {
        // The server trims, so this round trips to exactly what is stored.
        const draft = templateDraft(`  ${SAVED}  `, SAVED);

        expect(draft.dirty).toBe(false);
        expect(draft.canSave).toBe(false);
    });

    test('blocks an empty message and says why', () => {
        const draft = templateDraft('   ', SAVED);

        expect(draft.canSave).toBe(false);
        expect(draft.issue).toBe('The message cannot be empty.');
    });

    test('blocks an over-long message and counts the overage', () => {
        const draft = templateDraft('x'.repeat(TEMPLATE_MAX + 3), SAVED);

        expect(draft.canSave).toBe(false);
        expect(draft.issue).toContain('Too long by 3 characters');
    });

    test('counts a single character over in the singular', () => {
        expect(templateDraft('x'.repeat(TEMPLATE_MAX + 1), SAVED).issue).toContain(
            'Too long by 1 character.',
        );
    });

    test('allows a message exactly at the limit', () => {
        const draft = templateDraft('x'.repeat(TEMPLATE_MAX), SAVED);

        expect(draft.issue).toBeNull();
        expect(draft.canSave).toBe(true);
    });

    // The server accepts 1000 characters and this pane holds 320, so a message
    // saved elsewhere can arrive too long for the field. The pane explains the
    // unavailable Save; it must not claim the stored message is unsaved.
    test('explains an unsaveable saved message without calling it an edit', () => {
        const draft = templateDraft(null, 'x'.repeat(TEMPLATE_MAX + 10));

        expect(draft.dirty).toBe(false);
        expect(draft.canSave).toBe(false);
        expect(draft.issue).toContain('Too long by 10 characters');
    });
});

/**
 * The patient number is the number the **next new patient will be given**. It
 * used to be the last one handed out, labelled `Last patient number`, and every
 * clinic that typed 910 into it watched the next patient come out as 911 —
 * because the field said "last" and everybody read it as "next".
 *
 * The 910/911 report is asserted on the server, where the counter actually
 * lives (`tests/modules.test.ts`). What is left here is what the field itself
 * can refuse without seeing the register.
 */
describe('the next patient number', () => {
    test('takes digits and nothing else', () => {
        expect(patientNumberDigits('910')).toBe('910');
        expect(patientNumberDigits('9 1 0')).toBe('910');
        expect(patientNumberDigits('91o')).toBe('91');
        expect(patientNumberDigits('12345678901234')).toBe('1234567890');
    });

    test('accepts the figure a clinic carrying on from a paper count types', () => {
        expect(patientNumberError('910')).toBeNull();
        expect(patientNumberError('1')).toBeNull();
    });

    test('refuses a blank, and says what the field is for', () => {
        expect(patientNumberError('')).toContain('next new patient');
        expect(patientNumberError('   ')).toContain('next new patient');
    });

    // Zero was valid under the old meaning — "no numbers handed out yet" — and
    // is not under this one: nobody writes patient 0 at the top of a file.
    test('refuses zero, which the old meaning allowed', () => {
        expect(patientNumberError('0')).toContain('first patient number is 1');
    });

    test('refuses a number the column cannot hold', () => {
        expect(patientNumberError('2147483647')).toBeNull();
        expect(patientNumberError('2147483648')).toContain('larger than');
    });
});

describe('backup status on the index', () => {
    const now = Date.parse('2026-09-20T09:00:00Z');
    const ok = {
        lastSuccessAt: '2026-09-20T03:00:00Z',
        stale: false,
        staleAfterHours: 48,
        offsite: { configured: true, reauthorizationRequiredSince: null, account: null, canSignIn: false },
    };

    test('says nothing loud when the clinic is backed up', () => {
        const view = backupView(ok, now);
        expect(view.tone).toBe('ok');
        expect(view.sub).toBe('Last backup today · copied off-site');
        expect(view.detail).toBeNull();
    });

    test('names the machine when there is no off-site copy configured', () => {
        const view = backupView({ ...ok, offsite: { ...ok.offsite, configured: false } }, now);
        expect(view.sub).toBe('Last backup today · on this machine only');
    });

    // The dump still runs and still verifies, so nothing else on the phone looks
    // wrong — this row is the only place the doctor can find out.
    test('a revoked grant outranks everything else on the row', () => {
        const view = backupView(
            {
                ...ok,
                stale: true,
                offsite: {
                    configured: true,
                    reauthorizationRequiredSince: '2026-09-17T03:00:00Z',
                    account: null,
                    canSignIn: false,
                },
            },
            now,
        );

        expect(view.tone).toBe('reauthorize');
        expect(view.sub).toBe('Google Drive needs a new sign-in');
        expect(view.detail).toContain('stopped for 3 days');
        expect(view.detail).toContain('sign in to Google Drive again');
    });

    test('does not say "0 days" on the day it breaks', () => {
        const view = backupView(
            {
                ...ok,
                offsite: {
                    configured: true,
                    reauthorizationRequiredSince: '2026-09-20T07:00:00Z',
                    account: null,
                    canSignIn: false,
                },
            },
            now,
        );
        expect(view.detail).not.toContain('0 days');
        expect(view.detail).toContain('The off-site copy has stopped.');
    });

    test('falls back to stale when the grant is fine but nothing has run', () => {
        const view = backupView({ ...ok, lastSuccessAt: null, stale: true }, now);
        expect(view.tone).toBe('stale');
        expect(view.sub).toBe('No backup yet');
        // Only `reauthorize` draws a card, so a detail here would never be read.
        expect(view.detail).toBeNull();
    });

    test('offers the sign-in in the card only when the server can run it', () => {
        const broken = {
            ...ok,
            offsite: {
                configured: true,
                reauthorizationRequiredSince: '2026-09-17T03:00:00Z',
                account: 'doctor@example.com',
                canSignIn: true,
            },
        };

        const onPhone = backupView(broken, now);
        expect(onPhone.detail).toContain('Open Backups below');
        expect(onPhone.canSignIn).toBe(true);
        expect(onPhone.account).toBe('doctor@example.com');

        // An operator-only server must not tell the doctor to do something the
        // app cannot offer.
        const operatorOnly = backupView({ ...broken, offsite: { ...broken.offsite, canSignIn: false } }, now);
        expect(operatorOnly.detail).toContain('Ask whoever set up the clinic server');
        expect(operatorOnly.detail).not.toContain('Open Backups below');
    });

    test('localizes the sign-in failures from ERROR_CODE, never a server message', () => {
        expect(driveSignInError('DRIVE_SIGN_IN_UNCONFIGURED')).toContain('not set up');
        expect(driveSignInError('DRIVE_LINK_FAILED')).toContain('refused');
        expect(driveSignInError('SOMETHING_NEW')).toBe('Could not link Google Drive');
    });

    test('reads an unparseable timestamp as no backup rather than throwing', () => {
        expect(backupView({ ...ok, lastSuccessAt: 'not-a-date', stale: true }, now).sub).toBe(
            'No backup yet',
        );
        expect(ageInDays('not-a-date', now)).toBeNull();
    });

    test('reads one day as yesterday rather than "1 days"', () => {
        const view = backupView(
            {
                ...ok,
                offsite: {
                    configured: true,
                    reauthorizationRequiredSince: '2026-09-19T03:00:00Z',
                    account: null,
                    canSignIn: false,
                },
            },
            now,
        );
        expect(view.detail).toContain('since yesterday');
    });

    test('never reports a negative age from a clock that disagrees', () => {
        expect(ageInDays('2026-09-21T09:00:00Z', now)).toBe(0);
        expect(formatAge(0)).toBe('today');
        expect(formatAge(1)).toBe('yesterday');
    });
});

describe('the Backups pane', () => {
    const now = Date.parse('2026-09-20T09:00:00Z');
    const linked = {
        lastSuccessAt: '2026-09-19T03:00:00Z',
        stale: false,
        staleAfterHours: 48,
        offsite: {
            configured: true,
            reauthorizationRequiredSince: null,
            account: 'clinic@example.com',
            canSignIn: true,
        },
    };

    test('names the account and puts the clock time back on the age', () => {
        const details = backupDetails(linked, now);
        expect(details.headline).toBe('Backups are up to date');
        expect(details.dot).toBe('success');
        expect(details.last).toBe('03:00 · yesterday');
        expect(details.offsite).toBe('clinic@example.com');
        expect(details.note).toBeNull();
    });

    // The age sits beside a clock time, so it counts midnights, not 24-hour spans.
    test('a backup from before midnight is yesterday, however recent', () => {
        const lastNight = new Date(instantAt('2026-09-19', 23 * 60)).toISOString();
        const details = backupDetails({ ...linked, lastSuccessAt: lastNight }, instantAt('2026-09-20', 60));
        expect(details.last.endsWith('· yesterday')).toBe(true);
    });

    test('says how far behind is behind', () => {
        const details = backupDetails({ ...linked, stale: true }, now);
        expect(details.dot).toBe('due');
        expect(details.note).toBe('No backup in over 48h.');
    });

    test('a machine with no off-site copy says so rather than naming Drive', () => {
        const details = backupDetails(
            {
                ...linked,
                lastSuccessAt: null,
                offsite: { ...linked.offsite, configured: false, account: null },
            },
            now,
        );
        expect(details.last).toBe('No backup yet');
        expect(details.offsite).toBe('On this machine only');
    });

    test('the index only opens the pane once Drive is linked', () => {
        expect(backupView(linked, now).linked).toBe(true);
        expect(backupView({ ...linked, offsite: { ...linked.offsite, configured: false } }, now).linked).toBe(
            false,
        );
        expect(
            backupView(
                {
                    ...linked,
                    offsite: { ...linked.offsite, reauthorizationRequiredSince: '2026-09-18T03:00:00Z' },
                },
                now,
            ).linked,
        ).toBe(false);
    });
});
