/**
 * `byAppointment` returns the full visit (not the bare row): every caller wants
 * it to check the patient out, and handing back a row would make each of them
 * follow with `byId`.
 */
import { clinicProcedure, paymentProcedure, router } from '../../trpc/init.ts';
import {
    checkInInput,
    checkOutInput,
    deletePaymentInput,
    deleteVisitInput,
    recordPaymentInput,
    reopenInput,
    setPaidInput,
    setPaidMethodInput,
    setPriceInput,
    setProceduresInput,
    visitByAppointmentInput,
    visitByIdInput,
} from './visit.schema.ts';
import { visitService } from './visit.service.ts';

export const visitRouter = router({
    byId: clinicProcedure
        .input(visitByIdInput)
        .query(({ input, ctx }) => visitService.byId(input.id, ctx.caller.role)),

    byAppointment: clinicProcedure.input(visitByAppointmentInput).query(async ({ input, ctx }) => {
        const row = await visitService.byAppointment(input.appointmentId);
        return row ? visitService.byId(row.id, ctx.caller.role) : null;
    }),

    checkIn: clinicProcedure.input(checkInInput).mutation(({ input }) => visitService.checkIn(input)),

    setProcedures: clinicProcedure
        .input(setProceduresInput)
        .mutation(({ input, ctx }) => visitService.setProcedures(input, ctx.caller.role)),

    setPrice: clinicProcedure
        .input(setPriceInput)
        .mutation(({ input, ctx }) => visitService.setPrice(input, ctx.caller.role)),

    checkOut: clinicProcedure
        .input(checkOutInput)
        .mutation(({ input, ctx }) => visitService.checkOut(input, ctx.caller.role)),

    recordPayment: paymentProcedure
        .input(recordPaymentInput)
        .mutation(({ input }) => visitService.recordPayment(input)),

    reopen: clinicProcedure
        .input(reopenInput)
        .mutation(({ input, ctx }) => visitService.reopen(input, ctx.caller.role)),

    setPaid: paymentProcedure.input(setPaidInput).mutation(({ input }) => visitService.setPaid(input)),

    setPaidMethod: paymentProcedure
        .input(setPaidMethodInput)
        .mutation(({ input }) => visitService.setPaidMethod(input)),

    delete: clinicProcedure.input(deleteVisitInput).mutation(({ input }) => visitService.delete(input)),

    deletePayment: paymentProcedure
        .input(deletePaymentInput)
        .mutation(({ input }) => visitService.deletePayment(input)),
});
