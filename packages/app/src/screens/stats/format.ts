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
