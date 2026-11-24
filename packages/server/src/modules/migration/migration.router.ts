import { clinicProcedure, router } from '../../trpc/init.ts';
import { migrationService } from './migration.service.ts';

export const migrationRouter = router({
    progress: clinicProcedure.query(({ ctx }) => migrationService.progress(ctx.caller.role)),
});
