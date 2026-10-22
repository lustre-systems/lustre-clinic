import { clinicProcedure, router, setupProcedure } from '../../trpc/init.ts';
import { procedureHistoryService } from './procedure.history.ts';
import {
    addOldVisitInput,
    createCategoryInput,
    createProcedureInput,
    procedureTreeInput,
    reorderProceduresInput,
    updateProcedureInput,
} from './procedure.schema.ts';
import { procedureService } from './procedure.service.ts';

export const procedureRouter = router({
    tree: clinicProcedure
        .input(procedureTreeInput)
        .query(({ input, ctx }) => procedureService.tree(input, ctx.caller.role)),

    list: clinicProcedure.query(({ ctx }) => procedureService.selectableList(ctx.caller.role)),

    create: setupProcedure
        .input(createProcedureInput)
        .mutation(({ input }) => procedureService.create(input)),

    createCategory: setupProcedure
        .input(createCategoryInput)
        .mutation(({ input }) => procedureService.createCategory(input)),

    update: setupProcedure
        .input(updateProcedureInput)
        .mutation(({ input }) => procedureService.update(input)),

    reorder: setupProcedure
        .input(reorderProceduresInput)
        .mutation(({ input }) => procedureService.reorder(input)),

    /** A visit that happened on a day that has passed and was never typed in. */
    addOldVisit: clinicProcedure
        .input(addOldVisitInput)
        .mutation(({ input }) => procedureHistoryService.addOldVisit(input)),
});
