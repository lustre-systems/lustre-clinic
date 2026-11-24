import { ERROR_CODE, localizeCopy } from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';
import type { RequestError } from './data';

export interface ErrorMessage {
    title: string;
    body?: string;
}

export type ErrorContext = 'walk-in' | 'booking' | 'move' | 'check-in' | 'check-out' | 'day' | 'generic';

export function describeError(error: RequestError, context: ErrorContext = 'generic'): ErrorMessage {
    return localize(englishError(error, context));
}

function localize({ title, body }: ErrorMessage): ErrorMessage {
    const locale = getLocale();
    const localized = localizeCopy(locale, title);
    return body === undefined ? { title: localized } : { title: localized, body: localizeCopy(locale, body) };
}

function englishError(error: RequestError, context: ErrorContext): ErrorMessage {
    if (error.offline) {
        return {
            title: 'The clinic server did not answer',
            body: 'Nothing was saved. Check the clinic PC is on and try again.',
        };
    }

    switch (error.code) {
        case ERROR_CODE.SLOT_OVERLAP:
            return {
                title: 'That slot is taken',
                body:
                    context === 'walk-in'
                        ? 'Someone is already booked for that time. Give this walk-in a shorter visit, or finish the patient in the chair first.'
                        : context === 'booking'
                          ? 'That time was taken while this was being filled in. Go back and pick another one — the times have been reloaded.'
                          : 'Someone is already booked for that time. Pick another time, or shorten the appointment.',
            };

        case ERROR_CODE.INVALID_DURATION:
            return {
                title: 'That length is not one of the clinic’s',
                body: 'Pick one of the durations set up in Settings.',
            };

        case ERROR_CODE.INVALID_STATUS_TRANSITION:
            return {
                title: 'That has already moved on',
                body: 'Someone else changed this appointment. Close this and open it again.',
            };

        case ERROR_CODE.VISIT_ALREADY_EXISTS:
            return { title: 'This patient is already checked in' };

        case ERROR_CODE.CHECK_IN_NOT_TODAY:
            return {
                title: 'This appointment is not today',
                body: 'A patient is checked in on the day of their appointment. Move it to today first if they are here now.',
            };

        case ERROR_CODE.VISIT_ALREADY_COMPLETED:
            return { title: 'This visit is already checked out' };

        case ERROR_CODE.HAS_PAYMENTS:
            return {
                title: 'This visit has payments on it',
                body: 'Money that was taken stays on the record. Remove the payments first if they were entered by mistake.',
            };

        case ERROR_CODE.VISIT_HAS_NO_PROCEDURES:
            return {
                title: 'Add what was done first',
                body: 'A visit needs at least one procedure before it can be checked out.',
            };

        case ERROR_CODE.NOT_FOUND:
            return {
                title: context === 'day' ? 'That day could not be loaded' : 'That is no longer there',
                body: 'It may have been cancelled or removed. Reload the day.',
            };

        case ERROR_CODE.INVALID_PHONE:
            return {
                title: 'That phone number does not look right',
                body: 'Use the number as it is dialled, for example 010 1234 5678.',
            };

        case ERROR_CODE.VALIDATION:
            return { title: 'Something in that was not accepted', body: 'Check the details and try again.' };

        case ERROR_CODE.AGE_REQUIRED:
            return {
                title: 'This clinic needs the patient’s age',
                body: 'Add it to their record, or change that in Settings → Patient fields.',
            };

        case ERROR_CODE.GENDER_REQUIRED:
            return {
                title: 'This clinic needs the patient’s sex',
                body: 'Add it to their record, or change that in Settings → Patient fields.',
            };

        case ERROR_CODE.INVALID_AMOUNT:
            return { title: 'That amount is not allowed', body: 'Enter the amount in whole pounds.' };

        case ERROR_CODE.PAYMENT_EXCEEDS_BALANCE:
            return {
                title: 'That is more than they owe',
                body: 'Part of this visit was already paid. Take the rest at the desk.',
            };

        case ERROR_CODE.PAYMENT_NOTE_REQUIRED:
            return {
                title: 'Say how they paid',
                body: 'Other needs a note — Instapay to whom, or which card.',
            };

        case ERROR_CODE.DB_UNAVAILABLE:
            return {
                title: 'The clinic server is not answering',
                body: 'Nothing was saved. Try again in a moment.',
            };

        default:
            return {
                title: writeContext(context) ? 'That did not save' : 'That did not load',
                body: 'Nothing was changed. Try again — if it keeps failing, the clinic PC may need a restart.',
            };
    }
}

function writeContext(context: ErrorContext): boolean {
    return context !== 'day' && context !== 'generic';
}
