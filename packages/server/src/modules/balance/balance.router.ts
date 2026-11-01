import { paymentProcedure, router, statsProcedure } from '../../trpc/init.ts';
import {
    balanceSummaryInput,
    balanceTakingsInput,
    byPatientInput,
    outstandingInput,
    settleInput,
} from './balance.schema.ts';
import { balanceService } from './balance.service.ts';

export const balanceRouter = router({
    outstanding: paymentProcedure
        .input(outstandingInput)
        .query(({ input }) => balanceService.outstanding(input?.patientIds)),

    byPatient: paymentProcedure
        .input(byPatientInput)
        .query(({ input }) => balanceService.byPatient(input.patientId)),

    /** The app's one payment entry point: money against a patient, not a visit. */
    settle: paymentProcedure.input(settleInput).mutation(({ input }) => balanceService.settle(input)),

    // The clinic's takings, not one patient's: the owner's figures, like `stats`.
    summary: statsProcedure.input(balanceSummaryInput).query(({ input }) => balanceService.summary(input)),

    takings: statsProcedure.input(balanceTakingsInput).query(({ input }) => balanceService.takings(input)),
});
