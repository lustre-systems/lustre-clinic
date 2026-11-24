import { MAX_PATIENT_REF } from '@lustre/shared';

export function patientNumberDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, 10);
}

export function patientNumberError(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === '') return 'Type the number the next new patient should get.';

    const number = Number(trimmed);
    if (!Number.isInteger(number) || number < 1) return 'The first patient number is 1.';
    if (number > MAX_PATIENT_REF) return 'That number is larger than the system will hold.';

    return null;
}
