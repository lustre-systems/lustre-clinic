import { beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { withScratchDatabase } from '../src/backup/pg.ts';
import { config } from '../src/config.ts';
import { setupDatabase, sql } from './helpers/db.ts';

/**
 * SPEC §5 — the schema, and the migrations that produce it. Nothing else checks
 * that migrations apply to an *empty* database: `setupDatabase` is a no-op
 * after the first run, so the fresh-machine boot path was never exercised.
 * Migrations must also be idempotent, because the entrypoint migrates on every
 * start (§4). The scratch database doubles as a check on the truncation list —
 * a table added to the schema but forgotten in `truncateAll` leaks rows into
 * whichever test runs next. Double booking is prevented by Postgres, not
 * application code, and the EXCLUDE index requires an IMMUTABLE expression, so
 * the session-timezone test in overlap.test.ts guards against a volatile-
 * behaving wrapper.
 */

const TRUNCATED_TABLES = [
    'payments',
    'visit_procedures',
    'visit_next_procedures',
    'visits',
    'reminders',
    'ref_edits',
    'appointment_procedures',
    'appointments',
    'patients',
    'procedure_types',
    'clinic_days',
    'branches',
    'custom_questions',
    'devices',
    'role_grants',
    'settings',
] as const;

async function tablesIn(client: postgres.Sql): Promise<string[]> {
    const rows = await client<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    return rows.map((r) => r.tablename);
}

beforeAll(async () => {
    await setupDatabase();
});

describe('migrations', () => {
    test('apply to an empty database, and are idempotent', async () => {
        const scratch = `lustre_migrate_${Date.now()}_test`;

        await withScratchDatabase(config.DATABASE_URL, scratch, async (scratchUrl) => {
            const client = postgres(scratchUrl, { max: 1, onnotice: () => {} });

            try {
                const { drizzle } = await import('drizzle-orm/postgres-js');
                const { migrate } = await import('drizzle-orm/postgres-js/migrator');
                const migrationsFolder = new URL('../src/db/migrations', import.meta.url).pathname;
                const scratchDb = drizzle(client);

                await migrate(scratchDb, { migrationsFolder });
                const afterFirst = await tablesIn(client);

                await migrate(scratchDb, { migrationsFolder });
                const afterSecond = await tablesIn(client);

                expect(afterFirst.length).toBeGreaterThan(0);
                expect(afterSecond).toEqual(afterFirst);
            } finally {
                await client.end();
            }
        });
    }, 60_000);

    test('install btree_gist, without which the overlap constraint cannot exist', async () => {
        const [row] = await sql<{ present: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS present
        `;
        expect(row?.present).toBe(true);
    });

    test('create appointments_no_overlap', async () => {
        const [row] = await sql<{ present: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap'
            ) AS present
        `;
        expect(row?.present).toBe(true);
    });

    test('create the appointment_span helper', async () => {
        const [row] = await sql<{ present: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM pg_proc WHERE proname = 'appointment_span'
            ) AS present
        `;
        expect(row?.present).toBe(true);
    });

    test('declare appointment_span IMMUTABLE, as the exclusion index requires', async () => {
        const [row] = await sql<{ volatility: string }[]>`
            SELECT provolatile AS volatility FROM pg_proc WHERE proname = 'appointment_span'
        `;
        expect(row?.volatility).toBe('i');
    });
});

describe('schema and the truncation list', () => {
    test('every table the suite truncates exists', async () => {
        const present = await tablesIn(sql);

        for (const table of TRUNCATED_TABLES) {
            expect(present).toContain(table);
        }
    });

    test('every table in the schema is truncated between tests', async () => {
        const present = await tablesIn(sql);
        const untracked = present.filter(
            (table) =>
                !(TRUNCATED_TABLES as readonly string[]).includes(table) && table !== '__drizzle_migrations',
        );

        expect(untracked).toEqual([]);
    });
});
