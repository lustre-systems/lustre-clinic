import { clinicProcedure, router } from '../../trpc/init.ts';
import { dismissTodayInput, pendingRemindersInput, reminderIdInput } from './reminder.schema.ts';
import { reminderService } from './reminder.service.ts';

export const reminderRouter = router({
    pending: clinicProcedure
        .input(pendingRemindersInput)
        .query(({ input }) => reminderService.pending(input)),

    markSent: clinicProcedure
        .input(reminderIdInput)
        .mutation(({ input }) => reminderService.markSent(input.id)),

    markSkipped: clinicProcedure
        .input(reminderIdInput)
        .mutation(({ input }) => reminderService.markSkipped(input.id)),

    dismissToday: clinicProcedure
        .input(dismissTodayInput)
        .mutation(({ input }) => reminderService.dismissToday(input)),

    resumeToday: clinicProcedure
        .input(dismissTodayInput)
        .mutation(({ input }) => reminderService.resumeToday(input)),
});
