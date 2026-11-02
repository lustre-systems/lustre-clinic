/**
 * Entrypoint of the compiled server binary (`bun run build:server`). One binary
 * carries the server and the scripts it is operated with, so the clinic image
 * needs no source tree and no node_modules:
 *
 *   lustre                                          serve (the default)
 *   lustre migrate                                  as MIGRATION_DATABASE_URL
 *   lustre backup                                   one run of the nightly job
 *   lustre drive-authorize                           link the doctor's Drive once
 *   lustre restore <file> [--into <db>] [--key <k>]
 *   lustre seed                                     refuses a production database
 *   lustre grant <role> [label]                     print a one-time role QR (the first admin)
 *   lustre import-local <file>                      a clinic kept on one phone, into an empty server
 *
 * Each script reads its own arguments from argv[2] onward, so the command word
 * is taken out before the script is imported. `Bun.argv` is the same array.
 */
import { logger } from './logger.ts';

const COMMANDS = {
    serve: () => import('./index.ts'),
    migrate: () => import('../scripts/migrate.ts'),
    backup: () => import('../scripts/backup.ts'),
    'drive-authorize': () => import('../scripts/drive-authorize.ts'),
    restore: () => import('../scripts/restore.ts'),
    seed: () => import('../scripts/seed.ts'),
    grant: () => import('../scripts/grant.ts'),
    'import-local': () => import('../scripts/import-local.ts'),
};

type Command = keyof typeof COMMANDS;

function isCommand(value: string): value is Command {
    return Object.hasOwn(COMMANDS, value);
}

const requested = process.argv[2];

if (requested === undefined) {
    await COMMANDS.serve();
} else if (isCommand(requested)) {
    process.argv.splice(2, 1);
    await COMMANDS[requested]();
} else {
    logger.error(
        { command: requested },
        `unknown command; expected one of: ${Object.keys(COMMANDS).join(', ')}`,
    );
    process.exit(1);
}
