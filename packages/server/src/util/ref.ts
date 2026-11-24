import { PATIENT_REF_PATTERN, REF_ALPHABET, REF_PATTERN, REF_RANDOM_LENGTH } from '@lustre/shared';
import { refDatePart } from './time.ts';

function randomRefSuffix(): string {
    const bytes = new Uint8Array(REF_RANDOM_LENGTH);
    crypto.getRandomValues(bytes);

    let out = '';
    for (const byte of bytes) {
        out += REF_ALPHABET[byte % REF_ALPHABET.length];
    }
    return out;
}

export function buildRef(startsAt: Date, offsetMinutes = 0): string {
    return `${refDatePart(startsAt, offsetMinutes)}-${randomRefSuffix()}`;
}

export function highestNumericRef(refs: Iterable<string>): number {
    let highest = 0;
    for (const ref of refs) {
        if (/^\d+$/.test(ref)) highest = Math.max(highest, Number(ref));
    }
    return highest;
}

export function normalizeRef(raw: string): string {
    return raw.trim().toUpperCase();
}

export function isPatientRef(ref: string): boolean {
    return PATIENT_REF_PATTERN.test(ref);
}

export function isAppointmentRef(ref: string): boolean {
    return REF_PATTERN.test(ref);
}
