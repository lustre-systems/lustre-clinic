// Dates and error copy for the money cluster. Money itself is not formatted
// here — `MoneyValue` is the only place (§7.12). `visa` is labelled
// "Card" because that is what the desk calls it; the stored value is untouched.
// The client switches on `ERROR_CODE` and never parses the server's message,
// and this one map is where a localisation scaffold will land.
import {
    ERROR_CODE,
    type ErrorCode,
    localizeCopy,
    PAYMENT_METHODS,
    type PaymentMethod,
} from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';

const METHOD_LABEL: Record<PaymentMethod, string> = {
    cash: 'Cash',
    visa: 'Card',
    instapay: 'Instapay',
    other: 'Other',
};

/**
 * `visit.byId` types a payment's method as `string`, not the enum — the column
 * is a real Postgres enum and the widening is in `visit.service.ts`'s own
 * `VisitPayment`. Narrowing here keeps it out of every call site; a value that
 * is not a method at all can only mean the enum has grown, and labelling it
 * "Other" is a better answer than a blank row.
 */
export function paymentMethodOf(method: string): PaymentMethod {
    return (PAYMENT_METHODS as readonly string[]).includes(method) ? (method as PaymentMethod) : 'other';
}

export function methodLabel(method: string): string {
    return localizeCopy(getLocale(), METHOD_LABEL[paymentMethodOf(method)]);
}

const ERROR_MESSAGE: Partial<Record<ErrorCode, string>> = {
    [ERROR_CODE.DB_UNAVAILABLE]: "Can't reach the clinic server.",
    [ERROR_CODE.NOT_FOUND]: 'That visit no longer exists.',
    [ERROR_CODE.INVALID_AMOUNT]: 'That amount is not valid.',
    [ERROR_CODE.PAYMENT_NOTE_REQUIRED]: 'Say what the payment was.',
    [ERROR_CODE.VALIDATION]: 'That payment was rejected.',
};

export function errorMessage(code: ErrorCode): string {
    return localizeCopy(getLocale(), ERROR_MESSAGE[code] ?? 'Something went wrong.');
}
