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
