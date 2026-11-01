import { router, statsProcedure } from '../../trpc/init.ts';
import { statsOverviewInput, statsSummaryInput, statsTrendInput } from './stats.schema.ts';
import { statsService } from './stats.service.ts';

export const statsRouter = router({
    summary: statsProcedure.input(statsSummaryInput).query(({ input }) => statsService.summary(input)),

    overview: statsProcedure.input(statsOverviewInput).query(({ input }) => statsService.overview(input)),

    trend: statsProcedure.input(statsTrendInput).query(({ input }) => statsService.trend(input.periods)),
});
