import { clinicProcedure, router, setupProcedure } from '../../trpc/init.ts';
import { clearClinicDayInput, setClinicDayInput, updateSettingsInput } from './settings.schema.ts';
import { settingsService } from './settings.service.ts';

export const settingsRouter = router({
    get: clinicProcedure.query(() => settingsService.get()),

    update: clinicProcedure
        .input(updateSettingsInput)
        .mutation(({ input, ctx }) => settingsService.update(input, ctx.caller.role)),

    schedule: clinicProcedure.query(() => settingsService.schedule()),

    setDay: setupProcedure.input(setClinicDayInput).mutation(({ input }) => settingsService.setDay(input)),

    clearDay: setupProcedure
        .input(clearClinicDayInput)
        .mutation(({ input }) => settingsService.clearDay(input.weekday)),
});
