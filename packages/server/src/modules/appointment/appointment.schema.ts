import { MAX_AMOUNT_PIASTRES, MAX_DURATION_MINUTES, MIN_DURATION_MINUTES, toothSchema } from '@lustre/shared';
import { z } from 'zod';

const duration = z.number().int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES);

const offsetMinutes = z.number().int().min(-840).max(840).default(0);

const procedureLine = z.object({
    procedureId: z.uuid(),
    quantity: z.number().int().min(1).max(999).default(1),
    tooth: toothSchema.nullish(),
    note: z.string().trim().max(500).nullish(),
    quotedPrice: z.number().int().min(0).max(MAX_AMOUNT_PIASTRES).nullish(),
});

const procedures = z.array(procedureLine).max(100);

const needsLab = z.boolean().optional();

const patientRefInput = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), patientId: z.uuid() }),
    z.object({
        kind: z.literal('new'),
        name: z.string().trim().min(1).max(160),
        phone: z.string().trim().min(5).max(32),
        email: z.email().max(200).nullish(),
        birthDate: z.iso.date().nullish(),
        gender: z.string().trim().max(40).nullish(),
        notes: z.string().trim().max(4000).nullish(),
    }),
]);

export const createAppointmentInput = z.object({
    patient: patientRefInput,
    branchId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    durationMinutes: duration.optional(),
    procedures: procedures.optional(),
    note: z.string().trim().max(2000).nullish(),
    needsLab,
    offsetMinutes,
});

export const walkInInput = z.object({
    patient: patientRefInput,
    branchId: z.uuid(),
    durationMinutes: duration.optional(),
    procedures: procedures.optional(),
    note: z.string().trim().max(2000).nullish(),
    needsLab,
    offsetMinutes,
});

export const byDateInput = z.object({
    date: z.iso.date(),
    branchId: z.uuid().optional(),
    offsetMinutes,
});

export const byIdInput = z.object({ id: z.uuid() });

export const updateAppointmentInput = z.object({
    id: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    durationMinutes: duration.optional(),
    branchId: z.uuid().optional(),
    procedures: procedures.optional(),
    note: z.string().trim().max(2000).nullish(),
    status: z.literal('no_show').optional(),
    needsLab,
});

export const markLabReadyInput = z.object({ id: z.uuid() });

export const cancelAppointmentInput = z.object({ id: z.uuid() });

export const awaitPaymentInput = z.object({ id: z.uuid(), offsetMinutes });

export const missedInput = z
    .object({
        branchId: z.uuid().optional(),
        limit: z.number().int().min(1).max(200).default(100),
    })
    .default({ limit: 100 });

export type CreateAppointmentInput = z.infer<typeof createAppointmentInput>;
export type WalkInInput = z.infer<typeof walkInInput>;
export type ByDateInput = z.infer<typeof byDateInput>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentInput>;
export type MissedInput = z.infer<typeof missedInput>;
export type PatientRefInput = z.infer<typeof patientRefInput>;
