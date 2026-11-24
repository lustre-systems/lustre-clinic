import { startBackupJob } from './background/backup.job.ts';
import { config } from './config.ts';
import { runMigrations } from './db/migrate.ts';
import { logger } from './logger.ts';
import { healthService } from './modules/health/health.service.ts';
import { settingsService } from './modules/settings/settings.service.ts';
import { alert, startMonitoring, stopMonitoring } from './monitoring/index.ts';
import { createServer } from './server.ts';

startMonitoring({ isHealthy: async () => (await healthService.check()).ok });

if (config.MIGRATE_ON_BOOT) {
    try {
        await runMigrations();
        logger.info('migrations applied');
    } catch (err) {
        logger.fatal({ err }, 'migration failed');
        await alert({
            code: 'db.migration_failed',
            summary: 'Migrations failed on boot. The server did not start.',
            context: { error: err instanceof Error ? err.name : typeof err },
        });
        process.exit(1);
    }
} else {
    logger.info('migrations skipped on boot (MIGRATE_ON_BOOT=false)');
}

await settingsService.ensureSeeded();

const backupJob = startBackupJob();

const server = createServer();

logger.info({ port: server.port }, 'lustre server listening');

function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down');
    backupJob.stop();
    stopMonitoring();
    server.stop();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { config };
