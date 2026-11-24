import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config.ts';
import { db } from './index.ts';

const MIGRATIONS_FOLDER = config.MIGRATIONS_DIR ?? fileURLToPath(new URL('./migrations', import.meta.url));

export async function runMigrations(): Promise<void> {
    if (!config.MIGRATION_DATABASE_URL) {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
        return;
    }

    const owner = postgres(config.MIGRATION_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
        await migrate(drizzle(owner), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
        await owner.end();
    }
}
