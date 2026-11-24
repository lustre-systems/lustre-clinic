import { decrypt, parseKey } from '../src/backup/crypto.ts';
import { databaseName, pgRestore, recreateDatabase, withScratchDatabase } from '../src/backup/pg.ts';
import { config } from '../src/config.ts';
import { logger } from '../src/logger.ts';

const [file, ...rest] = Bun.argv.slice(2);

if (!file) {
    logger.error('usage: restore.ts <dump-file> [--into <database>] [--key <base64-or-hex>]');
    process.exit(1);
}

function flag(name: string): string | undefined {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? undefined : rest[i + 1];
}

const into = flag('into');
const keyArg = flag('key') ?? config.BACKUP_ENCRYPTION_KEY;

let dumpPath = file;
if (file.endsWith('.enc')) {
    if (!keyArg) {
        logger.error('encrypted dump: pass --key or set BACKUP_ENCRYPTION_KEY');
        process.exit(1);
    }
    dumpPath = `${file.replace(/\.enc$/, '')}.decrypted`;
    await Bun.write(dumpPath, decrypt(await Bun.file(file).bytes(), parseKey(keyArg)));
    logger.info({ file: dumpPath }, 'decrypted');
}

if (into) {
    if (into === databaseName(config.DATABASE_URL)) {
        logger.error({ database: into }, 'refusing to restore over the live database');
        process.exit(1);
    }
    const url = await recreateDatabase(config.DATABASE_URL, into);
    await pgRestore(url, dumpPath);
    logger.info({ database: into }, 'restored');
} else {
    const scratch = `${databaseName(config.DATABASE_URL)}_restore_check`;
    await withScratchDatabase(config.DATABASE_URL, scratch, async (scratchUrl) => {
        await pgRestore(scratchUrl, dumpPath);
        logger.info({ database: scratch }, 'restore verified');
    });
}
