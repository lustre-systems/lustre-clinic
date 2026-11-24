import { readLastSuccess, removePartialDumps, runBackup } from '../backup/index.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { alert } from '../monitoring/index.ts';

export interface BackupJob {
    runNow(): Promise<boolean>;
    stop(): void;
}

export function isBackupDue(lastSuccessAt: string | null, now: number, intervalMs: number): boolean {
    if (!lastSuccessAt) return true;
    const at = new Date(lastSuccessAt).getTime();
    if (Number.isNaN(at)) return true;
    return now - at >= intervalMs;
}

export function startBackupJob(): BackupJob {
    const intervalMs = config.BACKUP_INTERVAL_HOURS * 3_600_000;
    const staleAfterMs = config.BACKUP_STALE_AFTER_HOURS * 3_600_000;

    async function runNow(): Promise<boolean> {
        await cleanup;
        return runBackup().then(
            () => true,
            () => false,
        );
    }

    async function checkStaleness(): Promise<void> {
        const last = await readLastSuccess();
        const ageMs = last ? Date.now() - new Date(last.at).getTime() : Number.POSITIVE_INFINITY;

        if (ageMs > staleAfterMs) {
            await alert({
                code: 'backup.stale',
                summary: 'No backup has succeeded recently.',
                context: {
                    lastSuccessAt: last?.at ?? null,
                    thresholdHours: config.BACKUP_STALE_AFTER_HOURS,
                },
            });
        }
    }

    async function removeLeftovers(): Promise<void> {
        try {
            const removed = await removePartialDumps(config.BACKUP_DIR);
            if (removed.length > 0) {
                logger.warn({ files: removed }, 'removed partial dumps left by an interrupted run');
            }
        } catch (err) {
            logger.error({ err }, 'could not remove partial dumps');
        }
    }

    const cleanup = removeLeftovers();

    void cleanup
        .then(() => readLastSuccess())
        .then((last) => {
            if (isBackupDue(last?.at ?? null, Date.now(), intervalMs)) {
                logger.info({ lastSuccessAt: last?.at ?? null }, 'backup due at boot');
                return runNow().then(checkStaleness);
            }
            return checkStaleness();
        });

    const timer = setInterval(() => {
        void runNow().then(checkStaleness);
    }, intervalMs);
    timer.unref?.();

    logger.info({ intervalHours: config.BACKUP_INTERVAL_HOURS }, 'backup job started');

    return {
        runNow,
        stop() {
            clearInterval(timer);
        },
    };
}
