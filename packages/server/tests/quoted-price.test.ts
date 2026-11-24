import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_AMOUNT_PIASTRES } from '@lustre/shared';
import postgres from 'postgres';
import { withScratchDatabase } from '../src/backup/pg.ts';
import { config } from '../src/config.ts';
import { createAppointmentInput } from '../src/modules/appointment/appointment.schema.ts';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { procedureService } from '../src/modules/procedure/procedure.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { type Clinic, clinic, EXTRACTION_PRICE, ROOT_CANAL_PRICE, todaySlot } from './helpers/factories.ts';

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

type Planned = NonNullable<Parameters<typeof appointmentService.create>[0]['procedures']>;

async function book(plan: (fixtures: Clinic) => Planned = () => []) {
    const fixtures = await clinic();
    const appointment = await appointmentService.create({
        patient: { kind: 'existing', patientId: fixtures.patient.id },
        branchId: fixtures.branch.id,
        startsAt: todaySlot(),
        offsetMinutes: 0,
        procedures: plan(fixtures),
    });
    return { ...fixtures, appointment };
}

async function plannedOf(id: string) {
    return (await appointmentService.byId(id)).procedures.map((line) => [line.name, line.quotedPrice]);
}

describe('migration 0016', () => {
    test('adds a nullable quoted_price to appointment_procedures', async () => {
        const [column] = await sql<{ nullable: string; type: string }[]>`
            SELECT is_nullable AS nullable, data_type AS type
            FROM information_schema.columns
            WHERE table_name = 'appointment_procedures' AND column_name = 'quoted_price'
        `;
        expect(column).toEqual({ nullable: 'YES', type: 'integer' });
    });

    test('applies to a database already migrated past it', async () => {
        const migrationsFolder = new URL('../src/db/migrations', import.meta.url).pathname;
        const before = await mkdtemp(join(tmpdir(), 'lustre-before-0016-'));

        try {
            await cp(migrationsFolder, before, { recursive: true });
            const journalPath = join(before, 'meta', '_journal.json');
            const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
                entries: { tag: string; when: number }[];
            };
            const shipped = journal.entries.find((entry) => entry.tag === '0016_appointment_quoted_price');
            journal.entries = journal.entries.filter((entry) => shipped && entry.when < shipped.when);
            await writeFile(journalPath, JSON.stringify(journal));

            await withScratchDatabase(
                config.DATABASE_URL,
                `lustre_before_0016_${Date.now()}_test`,
                async (url) => {
                    const client = postgres(url, { max: 1, onnotice: () => {} });
                    try {
                        const { drizzle } = await import('drizzle-orm/postgres-js');
                        const { migrate } = await import('drizzle-orm/postgres-js/migrator');
                        const scratch = drizzle(client);
                        const hasColumn = async () =>
                            (
                                await client`
                                SELECT 1 FROM information_schema.columns
                                WHERE table_name = 'appointment_procedures' AND column_name = 'quoted_price'
                            `
                            ).length === 1;

                        await migrate(scratch, { migrationsFolder: before });
                        expect(await hasColumn()).toBe(false);

                        await migrate(scratch, { migrationsFolder });
                        expect(await hasColumn()).toBe(true);
                    } finally {
                        await client.end();
                    }
                },
            );
        } finally {
            await rm(before, { recursive: true, force: true });
        }
    }, 60_000);

    test('refuses a negative quote', async () => {
        const { appointment, rootCanal } = await book();

        let refused: unknown;
        try {
            await sql`
                INSERT INTO appointment_procedures (id, appointment_id, procedure_id, quoted_price)
                VALUES (${Bun.randomUUIDv7()}, ${appointment.id}, ${rootCanal.id}, -1)
            `;
        } catch (err) {
            refused = err;
        }
        expect((refused as { constraint_name?: string } | undefined)?.constraint_name).toBe(
            'appointment_procedures_quoted_price_non_negative',
        );
    });
});

describe('booking with a quoted price', () => {
    test('a line booked without one reads back as null', async () => {
        const { appointment } = await book(({ rootCanal }) => [{ procedureId: rootCanal.id, quantity: 1 }]);
        expect(await plannedOf(appointment.id)).toEqual([['Root canal', null]]);
    });

    test('create keeps a quote, line by line', async () => {
        const { appointment } = await book(({ rootCanal, extraction }) => [
            { procedureId: rootCanal.id, quantity: 1, quotedPrice: 200_000 },
            { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
        ]);

        expect(await plannedOf(appointment.id)).toEqual([
            ['Root canal', 200_000],
            ['Extraction', null],
        ]);
    });

    test('update can change only the price, and can take the quote away again', async () => {
        const { appointment, rootCanal } = await book(({ rootCanal }) => [
            { procedureId: rootCanal.id, quantity: 1 },
        ]);

        await appointmentService.update({
            id: appointment.id,
            procedures: [{ procedureId: rootCanal.id, quantity: 1, quotedPrice: 250_000 }],
        });
        expect(await plannedOf(appointment.id)).toEqual([['Root canal', 250_000]]);

        await appointmentService.update({ id: appointment.id, note: 'moved rooms' });
        expect(await plannedOf(appointment.id)).toEqual([['Root canal', 250_000]]);

        await appointmentService.update({
            id: appointment.id,
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
        });
        expect(await plannedOf(appointment.id)).toEqual([['Root canal', null]]);
    });

    test('the input refuses a quote that is not whole, negative or past the ceiling', () => {
        const line = (quotedPrice: number) => ({
            patient: { kind: 'existing', patientId: Bun.randomUUIDv7() },
            branchId: Bun.randomUUIDv7(),
            startsAt: todaySlot(),
            procedures: [{ procedureId: Bun.randomUUIDv7(), quotedPrice }],
        });

        expect(createAppointmentInput.safeParse(line(0)).success).toBe(true);
        expect(createAppointmentInput.safeParse(line(MAX_AMOUNT_PIASTRES)).success).toBe(true);
        expect(createAppointmentInput.safeParse(line(-1)).success).toBe(false);
        expect(createAppointmentInput.safeParse(line(1.5)).success).toBe(false);
        expect(createAppointmentInput.safeParse(line(MAX_AMOUNT_PIASTRES + 1)).success).toBe(false);
    });
});

describe('check-in', () => {
    test('bills a quote as quoted and the rest at the catalogue on the day', async () => {
        const { appointment, rootCanal, extraction } = await book(({ rootCanal, extraction }) => [
            { procedureId: rootCanal.id, quantity: 1, quotedPrice: 200_000 },
            { procedureId: extraction.id, quantity: 1, tooth: 'UL6' },
        ]);

        await procedureService.update({ id: rootCanal.id, defaultPrice: ROOT_CANAL_PRICE + 10_000 });
        await procedureService.update({ id: extraction.id, defaultPrice: EXTRACTION_PRICE + 5_000 });

        const created = await visitService.checkIn({ appointmentId: appointment.id });
        const visit = await visitService.byId(created.id);

        expect(visit.procedures.map((line) => [line.name, line.unitPrice])).toEqual([
            ['Root canal', 200_000],
            ['Extraction', EXTRACTION_PRICE + 5_000],
        ]);
        expect(visit.computedTotal).toBe(200_000 + EXTRACTION_PRICE + 5_000);
    });

    test('a walk-in bills its quote in the same transaction', async () => {
        const fixtures = await clinic();

        const { visitId } = await appointmentService.walkIn({
            patient: { kind: 'existing', patientId: fixtures.patient.id },
            branchId: fixtures.branch.id,
            offsetMinutes: 0,
            procedures: [{ procedureId: fixtures.extraction.id, quantity: 1, tooth: 'LR8', quotedPrice: 0 }],
        });

        const visit = await visitService.byId(visitId);
        expect(visit.procedures.map((line) => line.unitPrice)).toEqual([0]);
    });
});
