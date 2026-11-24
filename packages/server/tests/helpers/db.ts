import { databaseName } from '../../src/backup/pg.ts';
import { config } from '../../src/config.ts';
import { refuseProduction } from '../../src/db/environment.ts';
import { sql as dbSql } from '../../src/db/index.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { buildRef } from '../../src/util/ref.ts';

export const sql = dbSql;

const TEST_DATABASE_SUFFIX = '_test';

function assertTestDatabase(url = config.DATABASE_URL): void {
    const name = databaseName(url);

    if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
        throw new Error(
            `refusing to run tests against "${name}": the suite truncates every table.\n` +
                `Point DATABASE_URL at a database whose name ends in "${TEST_DATABASE_SUFFIX}" — ` +
                `\`bun test\` reads packages/server/.env.test, which expects "${name}${TEST_DATABASE_SUFFIX}".\n` +
                `Create it once with: docker compose exec db createdb -U lustre ${name}${TEST_DATABASE_SUFFIX}`,
        );
    }
}

let migrated = false;

export async function setupDatabase(): Promise<void> {
    if (migrated) return;
    assertTestDatabase();
    await refuseProduction(sql, 'run the test suite');
    await runMigrations();
    migrated = true;
}

export async function truncateAll(): Promise<void> {
    await sql`
        TRUNCATE TABLE
            payments,
            visit_procedures,
            visit_next_procedures,
            visits,
            reminders,
            ref_edits,
            appointment_procedures,
            appointments,
            patients,
            procedure_types,
            clinic_days,
            branches,
            custom_questions,
            devices,
            role_grants,
            settings
        RESTART IDENTITY CASCADE
    `;
}

export function uuid(): string {
    return Bun.randomUUIDv7();
}

export async function insertBranch(name = 'Main'): Promise<string> {
    const id = uuid();
    await sql`INSERT INTO branches (id, name) VALUES (${id}, ${name})`;
    return id;
}

export async function insertPatient(name = 'Test Patient'): Promise<string> {
    const id = uuid();
    let ref = '';
    while (!/\D/.test(ref)) ref = buildRef(new Date()).split('-')[1] ?? '';
    await sql`
        INSERT INTO patients (id, ref, name, phone, birth_date)
        VALUES (${id}, ${ref}, ${name}, '+201000000000', '1990-01-01')
    `;
    return id;
}
