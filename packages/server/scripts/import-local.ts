import { sql } from '../src/db/index.ts';
import { isAppError, pgConstraint, pgErrorCode } from '../src/errors/AppError.ts';
import { logger } from '../src/logger.ts';
import { importLocalClinic, parseLocalClinicFile } from '../src/modules/migration/localImport.ts';

const [path] = Bun.argv.slice(2);

if (!path) {
    logger.error('usage: import-local <clinic-file.db.gz>');
    process.exitCode = 1;
} else {
    try {
        const file = Bun.file(path);
        if (!(await file.exists())) throw new Error(`no file at ${path}`);
        const summary = await importLocalClinic(parseLocalClinicFile(await file.bytes()));
        logger.info(summary, 'clinic imported');
    } catch (err) {
        if (isAppError(err) || !pgErrorCode(err)) {
            logger.error({ reason: err instanceof Error ? err.message : String(err) }, 'import refused');
        } else {
            logger.error(
                { code: pgErrorCode(err), constraint: pgConstraint(err) },
                'import failed; nothing was written',
            );
        }
        process.exitCode = 1;
    }
}

await sql.end();
