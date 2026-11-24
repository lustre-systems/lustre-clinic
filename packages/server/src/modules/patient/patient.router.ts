import { clinicProcedure, router } from '../../trpc/init.ts';
import {
    createPatientInput,
    deletePatientInput,
    patientByIdInput,
    patientByPhoneInput,
    patientRefHistoryInput,
    recentPatientsInput,
    searchPatientInput,
    updatePatientInput,
    updatePatientRefInput,
} from './patient.schema.ts';
import { patientService } from './patient.service.ts';

export const patientRouter = router({
    search: clinicProcedure.input(searchPatientInput).query(({ input }) => patientService.search(input)),

    recent: clinicProcedure.input(recentPatientsInput).query(({ input }) => patientService.recent(input)),

    byId: clinicProcedure
        .input(patientByIdInput)
        .query(({ input, ctx }) => patientService.byId(input.id, ctx.caller.role)),

    byPhone: clinicProcedure.input(patientByPhoneInput).query(({ input }) => patientService.byPhone(input)),

    create: clinicProcedure.input(createPatientInput).mutation(({ input }) => patientService.create(input)),

    update: clinicProcedure.input(updatePatientInput).mutation(({ input }) => patientService.update(input)),

    updateRef: clinicProcedure
        .input(updatePatientRefInput)
        .mutation(({ input, ctx }) => patientService.updateRef(input, ctx.caller.role)),

    refHistory: clinicProcedure
        .input(patientRefHistoryInput)
        .query(({ input }) => patientService.refHistory(input.id)),

    delete: clinicProcedure
        .input(deletePatientInput)
        .mutation(({ input }) => patientService.delete(input.id)),
});
