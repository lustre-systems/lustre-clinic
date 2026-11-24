import {
    birthDateError,
    birthDateIso,
    blankRequired,
    DEFAULT_PATIENT_REQUIREMENTS,
    emailError,
    orNull,
    type PatientRequirements,
    phoneError,
} from '../../components/domain/patientDraft';
import type { Patient, PatientRef } from './data';

export {
    birthDateDigits,
    birthDateDisplay,
    birthDateError,
    birthDateIso,
    emailError,
} from '../../components/domain/patientDraft';

export type PatientDraft = {
    mode: 'existing' | 'new';
    term: string;
    picked: Patient | null;
    name: string;
    phone: string;
    email: string;
    birthDate: string;
    gender: string;
    notes: string;
};

export const EMPTY_PATIENT_DRAFT: PatientDraft = {
    mode: 'existing',
    term: '',
    picked: null,
    name: '',
    phone: '',
    email: '',
    birthDate: '',
    gender: '',
    notes: '',
};

export function patientRefOf(
    draft: PatientDraft,
    requires: PatientRequirements = DEFAULT_PATIENT_REQUIREMENTS,
): PatientRef | null {
    if (draft.mode === 'existing') {
        return draft.picked ? { kind: 'existing', patientId: draft.picked.id } : null;
    }

    const name = draft.name.trim();
    const phone = draft.phone.trim();
    if (name.length === 0 || phone.length === 0 || phoneError(phone) !== null) return null;
    if (emailError(draft.email) !== null || birthDateError(draft.birthDate) !== null) return null;
    if (blankRequired({ age: draft.birthDate, gender: draft.gender }, requires).length > 0) return null;

    return {
        kind: 'new',
        name,
        phone,
        email: orNull(draft.email),
        birthDate: draft.birthDate.length === 0 ? null : birthDateIso(draft.birthDate),
        gender: orNull(draft.gender),
        notes: orNull(draft.notes),
    };
}

export function patientNameOf(draft: PatientDraft): string {
    return draft.mode === 'existing' ? (draft.picked?.name ?? '') : draft.name.trim();
}

export function patientPhoneOf(draft: PatientDraft): string {
    return draft.mode === 'existing' ? (draft.picked?.phone ?? '') : draft.phone.trim();
}

export function draftFor(patient: Patient): PatientDraft {
    return { ...EMPTY_PATIENT_DRAFT, picked: patient };
}
