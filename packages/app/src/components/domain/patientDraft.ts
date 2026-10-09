/**
 * The field-level rules for a patient somebody is typing — a name, a number, an
 * email, an age or a date of birth, a sex. Three screens hold that draft and
 * each held its own copy of these: the booking's first step, the patient record,
 * and the bulk migration. None of it is React, so all of it is tested without a
 * renderer.
 *
 * What lives here is the rules. What does **not** is the submission shape: each
 * cluster keeps its own, because `patient.create`, `patient.update` and
 * `migration.enter` genuinely take three different things and an edit sends only
 * what moved.
 *
 * ## Age is stored as a date of birth
 *
 * This is the app's one lossy conversion, and the reason a third copy of it was
 * worth stopping. The design's basics row asks for a whole-number age; the
 * server has no age column — `patients.birth_date` is the fact and `age` is
 * derived from it at read time — so 34 is written as `1 January (this year −
 * 34)`, which reads back as 34 for the rest of this year and 35 next year. The
 * patient does age, which is the point. What is lost is the day they age *on*,
 * which a clinic that only ever asked "how old are you?" never knew either.
 *
 * The lossy half is guarded rather than accepted, and the guard is the callers':
 * `birthDate` is only sent when the age string on screen differs from the age
 * the record arrived with, so a patient booked in with a real date off an ID
 * card is never flattened to 1 January by an editor opened to fix their phone
 * number. That comparison is on the age *string*, not on the date it derives to.
 *
 * Where the desk types the date itself — the booking, which asks for it — no
 * conversion happens at all and `birthDateIso` takes the digits straight.
 *
 * Every check here is the client's courtesy, not the authority: the server
 * validates the same fields and would refuse a bad one anyway. They exist so a
 * typo is caught while the patient is still on the phone.
 */
import { DEFAULT_REQUIRE_AGE, DEFAULT_REQUIRE_GENDER, daysInMonth } from '@lustre/shared';
import { serverToday as todayKey } from '../../api/serverClock';

/** Stored lowercase, the way every record already on file spells it. */
export const FEMALE = 'female';
export const MALE = 'male';

/** The design's toggle, with `''` as the way back out of a mis-tap. */
export const GENDERS: readonly { value: string; label: string }[] = [
    { value: '', label: 'Not recorded' },
    { value: FEMALE, label: 'Female' },
    { value: MALE, label: 'Male' },
];

/** Deliberately loose. The server's is stricter; this one only catches the obvious. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The server refuses under 5 too. Short enough to be a mis-tap rather than a number. */
const SHORTEST_PHONE = 5;

/** Nobody has been alive longer than this, and a typo like `340` should not reach the server. */
const OLDEST_AGE = 129;

/** Day, month, year — the order an ID card is read out in. */
export const BIRTH_DATE_DIGITS = 8;

const EARLIEST_BIRTH_YEAR = 1900;

/** Blank means the question was not answered, and the record says so rather than storing an empty string. */
export function orNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function emailError(email: string): string | null {
    const value = email.trim();
    if (value.length === 0) return null;
    return EMAIL.test(value) ? null : 'That address is missing something.';
}

/**
 * Spaces and the leading `+` do not count towards the length: `+20 101 234 5678`
 * is a real number and refusing it for having spaces in it refuses the form the
 * desk pastes it in.
 *
 * Whether the field was *answered* is judged on what was typed, and only the
 * length on what is left after stripping. Judging both on the stripped string
 * reads a lone `"+"` as an untouched field and lets it through to the server —
 * separators are not an answer, but typing one is not nothing either.
 */
export function phoneError(phone: string): string | null {
    const entered = phone.trim();
    if (entered.length === 0) return null;
    const digits = entered.replace(/[\s+]/g, '');
    return digits.length < SHORTEST_PHONE ? 'That is too short to be a number.' : null;
}

/**
 * Required and still empty. The two a patient cannot be without, on every form
 * that registers one. A blank gets no message — the label turns `due` instead.
 */
export function blankNameAndPhone(form: { name: string; phone: string }): ('name' | 'phone')[] {
    const blank: ('name' | 'phone')[] = [];
    if (form.name.trim().length === 0) blank.push('name');
    if (form.phone.trim().length === 0) blank.push('phone');
    return blank;
}

/**
 * Whether the clinic requires an age and a sex (Settings → Patient fields). The
 * server enforces the same two rules; these only let a form mark the field due
 * before the round trip.
 */
export type PatientRequirements = { requireAge: boolean; requireGender: boolean };

/** What a clinic that has not touched the settings gets. */
export const DEFAULT_PATIENT_REQUIREMENTS: PatientRequirements = {
    requireAge: DEFAULT_REQUIRE_AGE,
    requireGender: DEFAULT_REQUIRE_GENDER,
};

/**
 * The age and the sex, when the clinic requires them and they are still empty.
 * `age` is whatever the form holds the age as — whole years on the record, a
 * typed date of birth on the booking — and is blank the same way either way.
 */
export function blankRequired(
    form: { age: string; gender: string },
    requires: PatientRequirements,
): ('age' | 'gender')[] {
    const blank: ('age' | 'gender')[] = [];
    if (requires.requireAge && form.age.trim().length === 0) blank.push('age');
    if (requires.requireGender && form.gender.trim().length === 0) blank.push('gender');
    return blank;
}

/** Typed, and wrong: a message for each. A form without an email field leaves `email` out. */
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

// --- the age, converted (the patient record and the migration) --------------

export function ageDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, 3);
}

/** 1 January of the year that makes the patient this old today. See the note above. */
export function birthDateOf(age: string, today: string = todayKey()): string | null {
    const years = Number(age);
    if (age.trim() === '' || !Number.isInteger(years) || years < 0 || years > OLDEST_AGE) return null;
    return `${Number(today.slice(0, 4)) - years}-01-01`;
}

export function ageError(age: string): string | null {
    if (age.trim() === '') return null;
    return birthDateOf(age) === null ? 'That is not an age.' : null;
}

// --- the date of birth, typed (the booking) ---------------------------------
//
// Typed, not picked: a calendar is the wrong instrument for a year forty years
// back, and the secretary is reading digits off an ID card out loud. So the
// field holds digits and nothing else and the slashes are drawn around them,
// which makes an interrupted entry (`0511`) a legible half-answer rather than
// an ambiguous date.

export function birthDateDigits(text: string): string {
    return text.replace(/\D/g, '').slice(0, BIRTH_DATE_DIGITS);
}

/**
 * What a typed day-month-year field shows: the digits so far, with the
 * separators the entry has earned. The data entry screen's cutoff date is typed
 * the same way.
 */
export function dateDigitsDisplay(digits: string): string {
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
        .filter((part) => part.length > 0)
        .join(' / ');
}

export const birthDateDisplay = dateDigitsDisplay;

/**
 * `YYYY-MM-DD` from `DDMMYYYY`, or null while the entry is incomplete or names a
 * day the calendar does not have. Which days a field accepts is the caller's
 * rule on top of this.
 */
export function calendarIsoOf(digits: string): string | null {
    // Digits only: `Number('aa')` is NaN, which slips past every range check below.
    if (!new RegExp(`^\\d{${BIRTH_DATE_DIGITS}}$`).test(digits)) return null;

    const day = Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    const year = Number(digits.slice(4, 8));

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;

    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

/** `YYYY-MM-DD` for the server, or null while the entry is incomplete or impossible. */
export function birthDateIso(digits: string, today: string = todayKey()): string | null {
    const iso = calendarIsoOf(digits);
    if (iso === null || Number(digits.slice(4, 8)) < EARLIEST_BIRTH_YEAR) return null;
    return iso > today ? null : iso;
}

/** What to say under the field, or null while there is nothing to correct. */
export function birthDateError(digits: string, today: string = todayKey()): string | null {
    if (digits.length === 0) return null;
    if (digits.length < BIRTH_DATE_DIGITS) return 'Day, month and year — 05 / 11 / 1990.';
    return birthDateIso(digits, today) === null ? 'That is not a date anyone was born on.' : null;
}
