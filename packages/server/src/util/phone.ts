import { ERROR_CODE } from '@lustre/shared';
import { AppError } from '../errors/AppError.ts';

const DEFAULT_COUNTRY_CODE = '20';

export function normalizePhone(raw: string): string {
    const trimmed = raw.trim();
    const cleaned = trimmed.replace(/[\s\-().]/g, '');

    let digits: string;

    if (cleaned.startsWith('+')) {
        digits = cleaned.slice(1);
    } else if (cleaned.startsWith('00')) {
        digits = cleaned.slice(2);
    } else if (cleaned.startsWith('0')) {
        digits = DEFAULT_COUNTRY_CODE + cleaned.slice(1);
    } else {
        digits = cleaned;
    }

    if (!/^\d{8,15}$/.test(digits)) {
        throw new AppError(ERROR_CODE.INVALID_PHONE, 'phone is not a valid E.164 number', 422);
    }

    return `+${digits}`;
}

export function phoneSearchTerm(raw: string): string | null {
    try {
        return normalizePhone(raw);
    } catch {}

    const cleaned = raw.trim().replace(/[\s\-().]/g, '');

    let digits: string;
    if (cleaned.startsWith('+')) digits = cleaned.slice(1);
    else if (cleaned.startsWith('00')) digits = cleaned.slice(2);
    else if (cleaned.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + cleaned.slice(1);
    else digits = cleaned;

    return /^\d+$/.test(digits) ? digits : null;
}

export function toWhatsAppNumber(e164: string): string {
    return e164.replace(/^\+/, '');
}
