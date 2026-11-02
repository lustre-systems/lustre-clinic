/**
 * Moves a clinic that ran on one phone onto this server:
 *
 *   bun cli import-local <clinic-file.db.gz>                  from a checkout
 *   lustre import-local /app/backups/<clinic-file.db.gz>      the compiled binary
 *
 * The file is a gzipped SQLite snapshot of the phone's clinic. The app has no way
 * to save one any more, so this waits on one being built (infra/README.md). The
 * server's database must be migrated (start the server once) and must hold no
 * patients or appointments; see `src/modules/migration/localImport.ts`.
 *
 * Only counts are logged. A Postgres error is logged by its code and
 * constraint, never its detail, which can quote the row it refused.
 */
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
