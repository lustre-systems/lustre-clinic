/**
 * SPEC §5. `phone` is normalized to E.164 in the service, not here. `custom` is
 * keyed by `custom_questions.key` and validated against them on write. Age is
 * derived from `birthDate` at read time and never stored.
 *
 * `old` is the block the New patient screen reveals behind its **Old patient**
 * switch: someone the clinic already had before the cutoff, carrying their own
 * number and what they owed on it. Its absence is what makes a registration a new one, so nothing about a
 * new patient changes by the block existing.
 */
import { clientRoleSchema, MAX_AMOUNT_PIASTRES, MAX_OLD_REF_LENGTH } from '@lustre/shared';
import { z } from 'zod';

const customAnswers = z.record(z.string(), z.unknown());

/**
 * The old system's number for this patient, off the paper file. Loose on
 * purpose — it is whatever that system used, not a `ref` this one generates,
 * and validating a format the app does not own would refuse real numbers.
 */
const legacyRef = z.string().trim().max(MAX_OLD_REF_LENGTH);

export const oldPatientInput = z.object({
    /**
     * The number the old system knew them by, which becomes this patient's
     * `ref`: the desk was given one number for them and must not be handed a
     * second. Never validated for shape — that format is the old system's.
     */
    ref: z.string().trim().min(1).max(MAX_OLD_REF_LENGTH),
    /** What they owed at the cutoff. Zero is not a balance, it is the absence of one. */
    openingBalance: z.number().int().positive().max(MAX_AMOUNT_PIASTRES).optional(),
});

export const createPatientInput = z.object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(5).max(32),
    email: z.email().max(200).nullish(),
    // Optional here and required by the service when the clinic says so
    // (`settings.require_age`, `settings.require_gender`).
    birthDate: z.iso.date().nullish(),
    gender: z.string().trim().max(40).nullish(),
    custom: customAnswers.default({}),
    notes: z.string().trim().max(4000).nullish(),
    legacyRef: legacyRef.nullish(),
    old: oldPatientInput.optional(),
});

export const updatePatientInput = z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().min(5).max(32).optional(),
    email: z.email().max(200).nullish(),
    birthDate: z.iso.date().nullish(),
    gender: z.string().trim().max(40).nullish(),
    custom: customAnswers.optional(),
    notes: z.string().trim().max(4000).nullish(),
    legacyRef: legacyRef.nullish(),
});

/**
 * Offset rather than a cursor so `search` keeps answering a bare array, which the
 * booking typeahead and app builds already in the field read.
 */
const page = {
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).max(1_000_000).default(0),
};

export const searchPatientInput = z.object({
    q: z.string().trim().max(120),
    ...page,
});

/** `name` is the register A–Z, for the list's "Alphabetical"; newest first otherwise. */
export const recentPatientsInput = z.object({ order: z.enum(['newest', 'name']).default('newest'), ...page });

export const patientByIdInput = z.object({ id: z.uuid() });

/**
 * Correcting the number a record is already known by — not the same act as
 * registering one, which is why it is not a field on `updatePatientInput`.
 *
 * The shape is checked in the service rather than here, so a mistyped ref comes
 * back as `PATIENT_REF_INVALID` and names the field, instead of as the generic
 * `VALIDATION` a Zod `regex` would produce. `editedBy` is the role the client
 * says it is on; the service decides whether that role may edit at all, and the
 * value is what lands in the audit trail.
 */
export const updatePatientRefInput = z.object({
    id: z.uuid(),
    ref: z.string().trim().min(1).max(MAX_OLD_REF_LENGTH),
    editedBy: clientRoleSchema,
});

export const patientRefHistoryInput = z.object({ id: z.uuid() });

export const deletePatientInput = z.object({ id: z.uuid() });

/** Loose on purpose — the service normalizes, and a term that will not normalize answers `[]`. */
export const patientByPhoneInput = z.object({ phone: z.string().trim().max(32) });

export type CreatePatientInput = z.infer<typeof createPatientInput>;
export type OldPatientInput = z.infer<typeof oldPatientInput>;
export type UpdatePatientInput = z.infer<typeof updatePatientInput>;
export type UpdatePatientRefInput = z.infer<typeof updatePatientRefInput>;
/** A direct service caller may leave `offset` out and read the first page, as the router's default does. */
type FirstPageByDefault<T extends { offset: number }> = Omit<T, 'offset'> & { offset?: number };
export type SearchPatientInput = FirstPageByDefault<z.infer<typeof searchPatientInput>>;
export type RecentPatientsInput = FirstPageByDefault<Omit<z.infer<typeof recentPatientsInput>, 'order'>> & {
    order?: z.infer<typeof recentPatientsInput>['order'];
};
export type PatientByPhoneInput = z.infer<typeof patientByPhoneInput>;
