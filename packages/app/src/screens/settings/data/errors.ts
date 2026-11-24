import { ERROR_CODE, type ErrorCode, localizeCopy } from '@lustre/shared';
import { classifyError } from '../../../api';
import { getLocale } from '../../../i18n/runtime';

const OFFLINE = "Couldn't reach the clinic computer. Nothing was saved.";
const GENERAL = 'Something went wrong. Try again.';

const TEXT: Partial<Record<ErrorCode, string>> = {
    [ERROR_CODE.NOT_FOUND]: 'That has been removed. Go back and try again.',
    [ERROR_CODE.DUPLICATE_KEY]: 'A question already uses that key. Pick another.',
    [ERROR_CODE.VALIDATION]: 'Check the fields and try again.',
    [ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP]: 'A category cannot go inside another category.',
    [ERROR_CODE.INVALID_DURATION]: 'The default has to be one of the durations offered.',
    [ERROR_CODE.PATIENT_REF_BELOW_EXISTING]:
        'A patient already has that number, or a higher one. Numbering has to carry on above it.',
    [ERROR_CODE.DB_UNAVAILABLE]: "Couldn't reach the clinic computer.",
    [ERROR_CODE.ROLE_FORBIDDEN]: 'This phone’s role cannot do that.',
};

export function errorText(error: unknown, overrides: Partial<Record<ErrorCode, string>> = {}): string {
    const locale = getLocale();
    if (!error) return localizeCopy(locale, GENERAL);

    const { kind, code } = classifyError(error);
    if (kind === 'offline' || kind === 'timeout') return localizeCopy(locale, OFFLINE);

    return localizeCopy(locale, overrides[code] ?? TEXT[code] ?? GENERAL);
}
