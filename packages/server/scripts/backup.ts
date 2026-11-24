import { runBackup } from '../src/backup/index.ts';
import { logger } from '../src/logger.ts';

try {
    const result = await runBackup();
    logger.info({ file: result.file, bytes: result.bytes }, 'backup written');
} catch {
    process.exitCode = 1;
}
