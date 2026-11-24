import { localizeCopy } from '@lustre/shared';
import { getLocale } from '../../../i18n/runtime';
import { PatientsRequestError } from './requestError';

const TEXT: Record<string, string> = {
    NOT_FOUND: 'This patient is no longer on file.',
    VALIDATION: 'One of the answers was not accepted. Check it and try again.',
    CUSTOM_QUESTION_REQUIRED: 'A required question was left blank.',
    AGE_REQUIRED:
        'This clinic needs an age on every patient. Type one, or change that in Settings → Patient fields.',
    GENDER_REQUIRED:
        'This clinic needs a sex on every patient. Choose one, or change that in Settings → Patient fields.',
    CONFLICT: 'Someone else changed this record. Reopen it and try again.',
    INTERNAL: 'The clinic server could not answer. Try again in a moment.',
    PAYMENT_EXCEEDS_BALANCE: 'That is more than this patient owes. Reopen the record and try again.',
    NOTHING_OUTSTANDING: 'This patient owes nothing.',
    HAS_PAYMENTS:
        'This patient has payments on file, so the record stays. Remove the payments from their visits first if they were entered by mistake.',
    PAYMENT_NOTE_REQUIRED: 'Say what the payment was.',
    INVALID_AMOUNT: 'That amount is not valid.',
    PATIENT_REF_TAKEN: 'Another patient already has that number. Check the old ref and try again.',
    PATIENT_REF_RESERVED:
        'That number has not been given out yet. Check the old ref, or raise the next patient number in Settings → Clinic.',
    PATIENT_REF_INVALID:
        'That is not a patient number. Use 910, or the four-character code on an older file.',
    MIGRATION_NOT_CONFIGURED:
        'The clinic server needs updating before it can take what an old patient owes. Register them without it for now.',
    IMPORTED_DATE_AFTER_CUTOFF:
        'One of the old procedures is dated after the cutoff. Work done since then belongs in a visit, not here.',
    INVALID_PHONE: 'That phone number was not accepted. Check it and try again.',
    TOOTH_REQUIRED: 'One of the old procedures is done to a tooth and has none. Remove it and add it again.',
    TOOTH_NOT_APPLICABLE: 'One of the old procedures is not done to a tooth. Remove it and add it again.',
    PROCEDURE_DUPLICATE: 'The same procedure is listed twice on one day. Remove one of them.',
    DB_UNAVAILABLE: 'The clinic server could not answer. Try again in a moment.',
};

const OFFLINE = 'Could not reach the clinic server. Check the connection and try again.';

export function errorText(error: unknown): string {
    const locale = getLocale();
    if (!(error instanceof PatientsRequestError)) return localizeCopy(locale, OFFLINE);
    if (error.offline) return localizeCopy(locale, OFFLINE);
    return localizeCopy(locale, TEXT[error.code] ?? OFFLINE);
}
