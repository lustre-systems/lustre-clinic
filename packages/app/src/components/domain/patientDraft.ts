import { DEFAULT_REQUIRE_AGE, DEFAULT_REQUIRE_GENDER, daysInMonth } from '@lustre/shared';
import { serverToday as todayKey } from '../../api/serverClock';

export const FEMALE = 'female';
export const MALE = 'male';

export const GENDERS: readonly { value: string; label: string }[] = [
    { value: '', label: 'Not recorded' },
    { value: FEMALE, label: 'Female' },
    { value: MALE, label: 'Male' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SHORTEST_PHONE = 5;

const OLDEST_AGE = 129;

export const BIRTH_DATE_DIGITS = 8;

const EARLIEST_BIRTH_YEAR = 1900;

export function orNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function emailError(email: string): string | null {
    const value = email.trim();
    if (value.length === 0) return null;
    return EMAIL.test(value) ? null : 'That address is missing something.';
}

export function phoneError(phone: string): string | null {
    const entered = phone.trim();
    if (entered.length === 0) return null;
    const digits = entered.replace(/[\s+]/g, '');
    return digits.length < SHORTEST_PHONE ? 'That is too short to be a number.' : null;
}

export function blankNameAndPhone(form: { name: string; phone: string }): ('name' | 'phone')[] {
    const blank: ('name' | 'phone')[] = [];
    if (form.name.trim().length === 0) blank.push('name');
    if (form.phone.trim().length === 0) blank.push('phone');
    return blank;
}

export type PatientRequirements = { requireAge: boolean; requireGender: boolean };

export const DEFAULT_PATIENT_REQUIREMENTS: PatientRequirements = {
    requireAge: DEFAULT_REQUIRE_AGE,
    requireGender: DEFAULT_REQUIRE_GENDER,
};

export function blankRequired(
    form: { age: string; gender: string },
    requires: PatientRequirements,
): ('age' | 'gender')[] {
    const blank: ('age' | 'gender')[] = [];
    if (requires.requireAge && form.age.trim().length === 0) blank.push('age');
    if (requires.requireGender && form.gender.trim().length === 0) blank.push('gender');
    return blank;
}

export function malformedDraft(form: {
    phone: string;
    email?: string;
    age: string;
}): Partial<Record<'phone' | 'email' | 'age', string>> {
    const found: Partial<Record<'phone' | 'email' | 'age', string>> = {};

    const phone = phoneError(form.phone);
    if (phone) found.phone = phone;

    const email = form.email === undefined ? null : emailError(form.email);
    if (email) found.email = email;

    const age = ageError(form.age);
    if (age) found.age = age;

    return found;
}

export function ageDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, 3);
}

export function birthDateOf(age: string, today: string = todayKey()): string | null {
    const years = Number(age);
    if (age.trim() === '' || !Number.isInteger(years) || years < 0 || years > OLDEST_AGE) return null;
    return `${Number(today.slice(0, 4)) - years}-01-01`;
}

export function ageError(age: string): string | null {
    if (age.trim() === '') return null;
    return birthDateOf(age) === null ? 'That is not an age.' : null;
}

export function birthDateDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, BIRTH_DATE_DIGITS);
}

export function dateDigitsDisplay(digits: string): string {
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
        .filter((part) => part.length > 0)
        .join(' / ');
}

export const birthDateDisplay = dateDigitsDisplay;

export function calendarIsoOf(digits: string): string | null {
    if (!new RegExp(`^\\d{${BIRTH_DATE_DIGITS}}$`).test(digits)) return null;

    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;

    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

export function birthDateIso(digits: string, today: string = todayKey()): string | null {
    const iso = calendarIsoOf(digits);
    if (iso === null || Number(digits.slice(4, 8)) < EARLIEST_BIRTH_YEAR) return null;
    return iso > today ? null : iso;
}

export function birthDateError(digits: string, today: string = todayKey()): string | null {
    if (digits.length === 0) return null;
    if (digits.length < BIRTH_DATE_DIGITS) return 'Day, month and year — 05 / 11 / 1990.';
    return birthDateIso(digits, today) === null ? 'That is not a date anyone was born on.' : null;
}
