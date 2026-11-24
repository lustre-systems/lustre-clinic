import { clientRoleSchema, MAX_AMOUNT_PIASTRES, MAX_OLD_REF_LENGTH } from '@lustre/shared';
import { z } from 'zod';

const customAnswers = z.record(z.string(), z.unknown());

const legacyRef = z.string().trim().max(MAX_OLD_REF_LENGTH);

export const oldPatientInput = z.object({
    ref: z.string().trim().min(1).max(MAX_OLD_REF_LENGTH),
    openingBalance: z.number().int().positive().max(MAX_AMOUNT_PIASTRES).optional(),
});

export const createPatientInput = z.object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(5).max(32),
    email: z.email().max(200).nullish(),
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

const page = {
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).max(1_000_000).default(0),
};

export const searchPatientInput = z.object({
    q: z.string().trim().max(120),
    ...page,
});

export const recentPatientsInput = z.object({ order: z.enum(['newest', 'name']).default('newest'), ...page });

export const patientByIdInput = z.object({ id: z.uuid() });

export const updatePatientRefInput = z.object({
    id: z.uuid(),
    ref: z.string().trim().min(1).max(MAX_OLD_REF_LENGTH),
    editedBy: clientRoleSchema,
});

export const patientRefHistoryInput = z.object({ id: z.uuid() });

export const deletePatientInput = z.object({ id: z.uuid() });

export const patientByPhoneInput = z.object({ phone: z.string().trim().max(32) });

export type CreatePatientInput = z.infer<typeof createPatientInput>;
export type OldPatientInput = z.infer<typeof oldPatientInput>;
export type UpdatePatientInput = z.infer<typeof updatePatientInput>;
export type UpdatePatientRefInput = z.infer<typeof updatePatientRefInput>;
type FirstPageByDefault<T extends { offset: number }> = Omit<T, 'offset'> & { offset?: number };
export type SearchPatientInput = FirstPageByDefault<z.infer<typeof searchPatientInput>>;
export type RecentPatientsInput = FirstPageByDefault<Omit<z.infer<typeof recentPatientsInput>, 'order'>> & {
    order?: z.infer<typeof recentPatientsInput>['order'];
};
export type PatientByPhoneInput = z.infer<typeof patientByPhoneInput>;
