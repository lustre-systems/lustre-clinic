import { MAX_AMOUNT_PIASTRES, paymentMethodSchema, toothSchema } from '@lustre/shared';
import { z } from 'zod';

const amount = z.number().int().min(0).max(MAX_AMOUNT_PIASTRES);

const offsetMinutes = z.number().int().min(-840).max(840).default(0);

export const checkInInput = z.object({ appointmentId: z.uuid(), offsetMinutes });

export const visitByIdInput = z.object({ id: z.uuid() });

export const visitByAppointmentInput = z.object({ appointmentId: z.uuid() });

const nextLine = z.object({ procedureId: z.uuid(), tooth: toothSchema.nullish() });

export const setProceduresInput = z.object({
    visitId: z.uuid(),
    procedures: z
        .array(
            z.object({
                procedureId: z.uuid(),
                quantity: z.number().int().min(1).max(999).default(1),
                unitPrice: amount.optional(),
                tooth: toothSchema.nullish(),
                note: z.string().trim().max(500).nullish(),
            }),
        )
        .max(100),
    nextProcedures: z.array(nextLine).max(20).optional(),
    nextProcedure: nextLine.nullable().optional(),
});

export const pendingNextInput = z.object({ patientId: z.uuid() });

export const setPriceInput = z.object({
    visitId: z.uuid(),
    chargedTotal: amount,
});

export const reopenInput = z.object({ visitId: z.uuid() });

export const deleteVisitInput = z.object({ visitId: z.uuid(), offsetMinutes });

export const deletePaymentInput = z.object({ paymentId: z.uuid() });

const payment = {
    method: paymentMethodSchema,
    methodNote: z.string().trim().max(200).nullish(),
};

export const checkOutInput = z
    .object({
        visitId: z.uuid(),
        chargedTotal: amount,
        paidTotal: amount.default(0),
        offsetMinutes,
        ...payment,
    })
    .refine((v) => v.paidTotal === 0 || v.method !== 'other' || !!v.methodNote?.trim(), {
        message: "method 'other' requires methodNote",
        path: ['methodNote'],
    });

export const setPaidInput = z
    .object({
        visitId: z.uuid(),
        paidTotal: amount,
        ...payment,
    })
    .refine((v) => v.method !== 'other' || !!v.methodNote?.trim(), {
        message: "method 'other' requires methodNote",
        path: ['methodNote'],
    });

export const setPaidMethodInput = z
    .object({
        visitId: z.uuid(),
        ...payment,
    })
    .refine((v) => v.method !== 'other' || !!v.methodNote?.trim(), {
        message: "method 'other' requires methodNote",
        path: ['methodNote'],
    });

export const recordPaymentInput = z
    .object({
        visitId: z.uuid(),
        amount: amount.refine((n) => n > 0, 'a payment must be positive'),
        ...payment,
    })
    .refine((v) => v.method !== 'other' || !!v.methodNote?.trim(), {
        message: "method 'other' requires methodNote",
        path: ['methodNote'],
    });

export type CheckInInput = z.input<typeof checkInInput>;
export type SetProceduresInput = z.infer<typeof setProceduresInput>;
export type SetPriceInput = z.infer<typeof setPriceInput>;
export type ReopenInput = z.infer<typeof reopenInput>;
export type DeleteVisitInput = z.input<typeof deleteVisitInput>;
export type DeletePaymentInput = z.infer<typeof deletePaymentInput>;
export type CheckOutInput = z.input<typeof checkOutInput>;
export type SetPaidInput = z.infer<typeof setPaidInput>;
export type SetPaidMethodInput = z.infer<typeof setPaidMethodInput>;
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;
