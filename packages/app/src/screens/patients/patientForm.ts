import { PATIENT_REF_PATTERN, PIASTRES_PER_POUND, todayKey } from '@lustre/shared';
import {
    birthDateOf,
    blankNameAndPhone,
    blankRequired,
    malformedDraft,
    orNull,
    type PatientRequirements,
} from '../../components/domain/patientDraft';
import type { Draft } from './components/customFields';
import { fromDraft, isAnswered, isEditable, toDraft } from './components/customFields';
import { isWholePounds } from './components/money';
import type {
    Answers,
    CreatePatientInput,
    CustomQuestion,
    OldPatientInput,
    Patient,
    UpdatePatientInput,
} from './data/types';

export {
    ageDigits,
    birthDateOf,
    DEFAULT_PATIENT_REQUIREMENTS,
    FEMALE,
    MALE,
    type PatientRequirements,
} from '../../components/domain/patientDraft';

export type PatientForm = {
    name: string;
    phone: string;
    email: string;
    ref: string;
    age: string;
    gender: string;
    answers: Draft;
    notes: string;
    old: OldPatientForm;
};

export type OldPatientForm = {
    on: boolean;
    ref: string;
    owes: string;
};

export const EMPTY_OLD: OldPatientForm = { on: false, ref: '', owes: '' };

export type PatientPrefill = { name: string } | { phone: string };

const PHONE_LIKE = /^[\d\s+-]+$/;

export function prefillOf(term: string): PatientPrefill | null {
    const text = term.trim();
    if (text === '') return null;
    return PHONE_LIKE.test(text) && /\d/.test(text) ? { phone: text } : { name: text };
}

export function emptyForm(questions: CustomQuestion[], prefill?: PatientPrefill): PatientForm {
    return {
        name: prefill && 'name' in prefill ? prefill.name : '',
        phone: prefill && 'phone' in prefill ? prefill.phone : '',
        email: '',
        ref: '',
        age: '',
        gender: '',
        answers: blankAnswers(questions),
        notes: '',
        old: EMPTY_OLD,
    };
}

export function formOf(patient: Patient, questions: CustomQuestion[]): PatientForm {
    const answers: Draft = {};
    for (const question of questions) answers[question.key] = toDraft(question, patient.custom[question.key]);

    return {
        name: patient.name,
        phone: patient.phone,
        email: patient.email ?? '',
        ref: patient.ref,
        age: patient.age === null ? '' : String(patient.age),
        gender: patient.gender ?? '',
        answers,
        notes: patient.notes ?? '',
        old: EMPTY_OLD,
    };
}

function blankAnswers(questions: CustomQuestion[]): Draft {
    const answers: Draft = {};
    for (const question of questions) answers[question.key] = '';
    return answers;
}

export type BasicsField = 'name' | 'phone' | 'email' | 'age' | 'gender';

export function blankBasics(form: PatientForm, requires: PatientRequirements): BasicsField[] {
    return [...blankNameAndPhone(form), ...blankRequired(form, requires)];
}

export function malformedBasics(form: PatientForm): Partial<Record<BasicsField, string>> {
    return malformedDraft(form);
}

function basicsAreSound(form: PatientForm, requires: PatientRequirements): boolean {
    return blankBasics(form, requires).length === 0 && Object.keys(malformedBasics(form)).length === 0;
}

function birthDateInputOf(age: string, today: string): string | null {
    return age.trim() === '' ? null : birthDateOf(age, today);
}

export function missingRequired(form: PatientForm, questions: CustomQuestion[]): string[] {
    return questions
        .filter((question) => question.required && !isAnswered(form.answers[question.key] ?? ''))
        .map((question) => question.key);
}

export function answeredCount(form: PatientForm, questions: CustomQuestion[]): number {
    return questions.filter((question) => isAnswered(form.answers[question.key] ?? '')).length;
}

export function unaskableRequired(questions: CustomQuestion[]): CustomQuestion[] {
    return questions.filter((question) => question.required && !isEditable(question));
}

export function clearedRequired(
    form: PatientForm,
    initial: PatientForm,
    questions: CustomQuestion[],
): string[] {
    return questions
        .filter(
            (question) =>
                question.required &&
                !isAnswered(form.answers[question.key] ?? '') &&
                isAnswered(initial.answers[question.key] ?? ''),
        )
        .map((question) => question.key);
}

function answersOf(form: PatientForm, questions: CustomQuestion[], only: (key: string) => boolean): Answers {
    const patch: Answers = {};
    for (const question of questions) {
        if (!only(question.key)) continue;
        patch[question.key] = fromDraft(question, form.answers[question.key] ?? '');
    }
    return patch;
}

export function owesInput(text: string): string {
    return text.trim().slice(0, 8);
}

const LARGEST_OWED_EGP = 100_000;

export function owesPiastres(pounds: string): number | null {
    const text = pounds.trim();
    if (text === '' || !isWholePounds(text)) return null;

    const value = Number(text);
    if (!Number.isInteger(value) || value <= 0 || value > LARGEST_OWED_EGP) return null;

    return value * PIASTRES_PER_POUND;
}

export type OldField = 'ref' | 'owes';

export function blankOld(form: PatientForm): OldField[] {
    if (!form.old.on) return [];
    return form.old.ref.trim() === '' ? ['ref'] : [];
}

export function malformedOld(form: PatientForm): Partial<Record<OldField, string>> {
    if (!form.old.on) return {};

    const owes = form.old.owes.trim();
    if (owes !== '' && owesPiastres(owes) === null) {
        return { owes: 'That is not an amount in pounds.' };
    }
    return {};
}

function oldIsSound(form: PatientForm): boolean {
    return blankOld(form).length === 0 && Object.keys(malformedOld(form)).length === 0;
}

function oldInputOf(form: PatientForm): OldPatientInput {
    const owes = owesPiastres(form.old.owes);

    return {
        ref: form.old.ref.trim(),
        ...(owes === null ? {} : { openingBalance: owes }),
        procedures: [],
    };
}

export function createInputOf(
    form: PatientForm,
    questions: CustomQuestion[],
    requires: PatientRequirements,
    today: string = todayKey(),
): CreatePatientInput | null {
    if (!basicsAreSound(form, requires)) return null;
    if (missingRequired(form, questions).length > 0) return null;
    if (!oldIsSound(form)) return null;

    return {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: orNull(form.email),
        birthDate: birthDateInputOf(form.age, today),
        gender: orNull(form.gender),
        custom: answersOf(form, questions, (key) => isAnswered(form.answers[key] ?? '')),
        notes: orNull(form.notes),
        ...(form.old.on ? { old: oldInputOf(form) } : {}),
    };
}

export function updateInputOf(
    id: string,
    form: PatientForm,
    initial: PatientForm,
    questions: CustomQuestion[],
    requires: PatientRequirements,
    today: string = todayKey(),
): UpdatePatientInput | null {
    if (!basicsAreSound(form, requires)) return null;
    if (clearedRequired(form, initial, questions).length > 0) return null;

    const patch: UpdatePatientInput = { id };

    if (form.name.trim() !== initial.name.trim()) patch.name = form.name.trim();
    if (form.phone.trim() !== initial.phone.trim()) patch.phone = form.phone.trim();
    if (form.email.trim() !== initial.email.trim()) patch.email = orNull(form.email);
    if (form.gender !== initial.gender) patch.gender = orNull(form.gender);
    if (form.notes.trim() !== initial.notes.trim()) patch.notes = orNull(form.notes);
    if (form.age.trim() !== initial.age.trim()) patch.birthDate = birthDateInputOf(form.age, today);

    const custom = answersOf(
        form,
        questions,
        (key) => (form.answers[key] ?? '').trim() !== (initial.answers[key] ?? '').trim(),
    );
    if (Object.keys(custom).length > 0) patch.custom = custom;

    return patch;
}

export function isUnchanged(patch: UpdatePatientInput): boolean {
    return Object.keys(patch).length === 1;
}

export function refError(ref: string): string | null {
    const trimmed = ref.trim();
    if (trimmed === '') return 'A patient keeps their number. Type the one on the file.';
    if (!PATIENT_REF_PATTERN.test(trimmed)) {
        return 'A number like 910, or the four-character code on an older file.';
    }
    return null;
}

export function refEditError(form: PatientForm, initial: PatientForm): string | null {
    if (form.ref.trim().toUpperCase() === initial.ref.trim().toUpperCase()) return null;
    return refError(form.ref);
}

export function refBaselineOf(
    initial: PatientForm | null,
    seededRef: string | null,
    savedRef: string | null,
): PatientForm | null {
    const onFile = savedRef ?? seededRef;
    return initial && onFile !== null ? { ...initial, ref: onFile } : null;
}

export function saveFailureTitle(refFailed: boolean, earlierRefLanded: boolean): string {
    return earlierRefLanded && !refFailed ? 'The number was saved, the rest was not' : 'Not saved';
}

export function refEditOf(form: PatientForm, initial: PatientForm): string | null {
    const next = form.ref.trim();
    if (next === '' || refError(next) !== null) return null;
    if (next.toUpperCase() === initial.ref.trim().toUpperCase()) return null;
    return next;
}

export const MAX_NOTES_LENGTH = 4000;
