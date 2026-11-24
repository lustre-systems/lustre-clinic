import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { branchService } from '../src/modules/branch/branch.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { buildRef } from '../src/util/ref.ts';
import { setupDatabase, sql, truncateAll, uuid } from './helpers/db.ts';
import { expectAppError, slot } from './helpers/factories.ts';

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

async function requires(requireAge: boolean, requireGender: boolean): Promise<void> {
    await settingsService.update({ requireAge, requireGender });
}

async function book(details: { birthDate?: string | null; gender?: string | null }) {
    const branch = await branchService.create({ name: 'Main' });
    return appointmentService.create({
        patient: { kind: 'new', name: 'Walk-up Wael', phone: '01099999999', ...details },
        branchId: branch.id,
        startsAt: slot(),
        offsetMinutes: 0,
    });
}

function register(details: { birthDate?: string | null; gender?: string | null }) {
    return patientService.create({ name: 'Nadia Hassan', phone: '01012345678', custom: {}, ...details });
}

describe('the defaults', () => {
    test('require an age and not a sex', async () => {
        const settings = await settingsService.get();
        expect(settings.requireAge).toBe(true);
        expect(settings.requireGender).toBe(false);
    });

    test('with no settings row yet, still require an age', async () => {
        expect(await settingsService.patientRequirements()).toEqual({
            requireAge: true,
            requireGender: false,
        });
        await expectAppError(ERROR_CODE.AGE_REQUIRED, () => register({}));
    });

    test('register and book a patient with an age and no sex', async () => {
        const created = await register({ birthDate: '1990-01-01' });
        expect(created.gender).toBeNull();

        const appointment = await book({ birthDate: '1990-01-01' });
        expect(appointment.patientId).toBeString();
    });
});

describe('requireAge', () => {
    test('on: registering or booking without an age is refused', async () => {
        await requires(true, false);

        await expectAppError(ERROR_CODE.AGE_REQUIRED, () => register({}));
        await expectAppError(ERROR_CODE.AGE_REQUIRED, () => register({ birthDate: null }));
        await expectAppError(ERROR_CODE.AGE_REQUIRED, () => book({}));
        await expectAppError(ERROR_CODE.AGE_REQUIRED, () => book({ birthDate: null }));

        const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`
            SELECT count(*)::int AS count FROM patients
        `;
        expect(count).toBe(0);
    });

    test('off: a patient is registered, booked and edited with no age', async () => {
        await requires(false, false);

        const created = await register({});
        expect(created.birthDate).toBeNull();
        expect(created.age).toBeNull();

        const appointment = await book({ birthDate: null });
        const booked = await patientService.byId(appointment.patientId);
        expect(booked.patient.birthDate).toBeNull();
        expect(booked.patient.age).toBeNull();

        const aged = await patientService.update({ id: created.id, birthDate: '1990-01-01' });
        expect(aged.age).not.toBeNull();

        const cleared = await patientService.update({ id: created.id, birthDate: null });
        expect(cleared.birthDate).toBeNull();
        expect(cleared.age).toBeNull();
    });

    test('on: an edit may not clear the age', async () => {
        await requires(true, false);
        const created = await register({ birthDate: '1990-01-01' });

        await expectAppError(ERROR_CODE.AGE_REQUIRED, () =>
            patientService.update({ id: created.id, birthDate: null }),
        );

        const kept = await patientService.byId(created.id);
        expect(kept.patient.birthDate).toBe('1990-01-01');
    });

    test('turned on, a record already without an age can still be edited and read', async () => {
        await requires(false, false);
        const created = await register({});

        await requires(true, false);
        const edited = await patientService.update({ id: created.id, phone: '01011112222' });
        expect(edited.phone).toBe('+201011112222');
        expect(edited.birthDate).toBeNull();

        const read = await patientService.byId(created.id);
        expect(read.patient.age).toBeNull();

        const aged = await patientService.update({ id: created.id, birthDate: '1990-01-01' });
        expect(aged.birthDate).toBe('1990-01-01');
    });
});

describe('requireGender', () => {
    test('on: registering or booking without a sex is refused', async () => {
        await requires(true, true);

        await expectAppError(ERROR_CODE.GENDER_REQUIRED, () => register({ birthDate: '1990-01-01' }));
        await expectAppError(ERROR_CODE.GENDER_REQUIRED, () =>
            register({ birthDate: '1990-01-01', gender: '   ' }),
        );
        await expectAppError(ERROR_CODE.GENDER_REQUIRED, () => book({ birthDate: '1990-01-01' }));
        await expectAppError(ERROR_CODE.GENDER_REQUIRED, () =>
            book({ birthDate: '1990-01-01', gender: null }),
        );

        const created = await register({ birthDate: '1990-01-01', gender: 'female' });
        expect(created.gender).toBe('female');

        const appointment = await book({ birthDate: '1990-01-01', gender: 'male' });
        expect((await patientService.byId(appointment.patientId)).patient.gender).toBe('male');
    });

    test('on, with age off: only the sex is asked for', async () => {
        await requires(false, true);

        const created = await register({ gender: 'female' });
        expect(created.birthDate).toBeNull();

        const appointment = await book({ gender: 'male' });
        expect((await patientService.byId(appointment.patientId)).patient.birthDate).toBeNull();
    });

    test('on: an edit may not clear the sex', async () => {
        await requires(true, true);
        const created = await register({ birthDate: '1990-01-01', gender: 'female' });

        await expectAppError(ERROR_CODE.GENDER_REQUIRED, () =>
            patientService.update({ id: created.id, gender: null }),
        );
        await expectAppError(ERROR_CODE.GENDER_REQUIRED, () =>
            patientService.update({ id: created.id, gender: '' }),
        );
        expect((await patientService.byId(created.id)).patient.gender).toBe('female');
    });

    test('off: an edit may clear the sex', async () => {
        await requires(true, false);
        const created = await register({ birthDate: '1990-01-01', gender: 'female' });

        const cleared = await patientService.update({ id: created.id, gender: null });
        expect(cleared.gender).toBeNull();
    });

    test('turned on, a record already without a sex can still be edited', async () => {
        const created = await register({ birthDate: '1990-01-01' });

        await requires(true, true);
        const edited = await patientService.update({ id: created.id, name: 'Nadia H.' });
        expect(edited.name).toBe('Nadia H.');
        expect(edited.gender).toBeNull();
    });
});

async function runMigrationFile(name: string): Promise<void> {
    const text = await Bun.file(new URL(`../src/db/migrations/${name}`, import.meta.url)).text();
    for (const statement of text.split('--> statement-breakpoint')) {
        await sql.unsafe(statement);
    }
}

describe('0017_patient_requirements', () => {
    test('makes birth_date nullable and gives the settings their defaults', async () => {
        const columns = await sql<{ table_name: string; column_name: string; is_nullable: string }[]>`
            SELECT table_name, column_name, is_nullable
            FROM information_schema.columns
            WHERE (table_name = 'patients' AND column_name = 'birth_date')
               OR (table_name = 'settings' AND column_name IN ('require_age', 'require_gender'))
            ORDER BY table_name, column_name
        `;
        expect(columns.map((c) => [c.table_name, c.column_name, c.is_nullable])).toEqual([
            ['patients', 'birth_date', 'YES'],
            ['settings', 'require_age', 'NO'],
            ['settings', 'require_gender', 'NO'],
        ]);

        await sql`INSERT INTO settings (id, clinic_name, reminder_template) VALUES (1, 'Clinic', 'Hi')`;
        const [row] = await sql<{ require_age: boolean; require_gender: boolean }[]>`
            SELECT require_age, require_gender FROM settings WHERE id = 1
        `;
        expect(row).toEqual({ require_age: true, require_gender: false });
    });

    test('is safe to run again, and leaves 0013 placeholders alone', async () => {
        const placeholder = `${new Date().getFullYear() - 100}-01-01`;
        const id = await insertPatientAt('2026-03-10T10:00:00Z', placeholder);

        await runMigrationFile('0017_patient_requirements.sql');

        expect(await birthDateOf(id)).toBe(placeholder);
    });
});

async function insertPatientAt(createdAt: string, birthDate: string | null): Promise<string> {
    const id = uuid();
    let ref = '';
    while (!/\D/.test(ref)) ref = buildRef(new Date()).split('-')[1] ?? '';
    await sql`
        INSERT INTO patients (id, ref, name, phone, birth_date, created_at)
        VALUES (${id}, ${ref}, 'Test Patient', '+201000000000', ${birthDate}, ${createdAt})
    `;
    return id;
}

async function birthDateOf(id: string): Promise<string | null> {
    const [row] = await sql<{ birth_date: string | null }[]>`
        SELECT birth_date::text AS birth_date FROM patients WHERE id = ${id}
    `;
    return row?.birth_date ?? null;
}

describe('0018_clear_zero_ages', () => {
    const ROWS = [
        {
            why: 'age 0, typed this year',
            createdAt: '2026-03-10T10:00:00Z',
            birthDate: '2026-01-01',
            after: null,
        },
        {
            why: 'age 0, typed last year',
            createdAt: '2025-06-01T10:00:00Z',
            birthDate: '2025-01-01',
            after: null,
        },
        {
            why: 'age 0, typed just after midnight on New Year in Cairo',
            createdAt: '2025-12-31T22:30:00Z',
            birthDate: '2026-01-01',
            after: null,
        },
        {
            why: 'age 1, typed just before midnight on New Year in Cairo',
            createdAt: '2025-12-31T21:30:00Z',
            birthDate: '2024-01-01',
            after: '2024-01-01',
        },
        { why: 'age 1', createdAt: '2026-03-10T10:00:00Z', birthDate: '2025-01-01', after: '2025-01-01' },
        { why: 'age 36', createdAt: '2026-03-10T10:00:00Z', birthDate: '1990-01-01', after: '1990-01-01' },
        {
            why: 'a real date of birth under a year old',
            createdAt: '2026-03-10T10:00:00Z',
            birthDate: '2026-02-14',
            after: '2026-02-14',
        },
        {
            why: 'a 0013 placeholder',
            createdAt: '2026-03-10T10:00:00Z',
            birthDate: '1926-01-01',
            after: '1926-01-01',
        },
        { why: 'no age at all', createdAt: '2026-03-10T10:00:00Z', birthDate: null, after: null },
    ] as const;

    test('empties ages of 0 and leaves every other age as it was, run once or twice', async () => {
        const ids = await Promise.all(ROWS.map((row) => insertPatientAt(row.createdAt, row.birthDate)));

        for (let run = 0; run < 2; run++) {
            await runMigrationFile('0018_clear_zero_ages.sql');

            const after = await Promise.all(ids.map(birthDateOf));
            expect(ROWS.map((row, i) => [row.why, after[i]])).toEqual(
                ROWS.map((row) => [row.why, row.after]),
            );
        }
    });

    test('a cleared record reads back with no age', async () => {
        const id = await insertPatientAt('2026-03-10T10:00:00Z', '2026-01-01');

        await runMigrationFile('0018_clear_zero_ages.sql');

        const read = await patientService.byId(id);
        expect(read.patient.birthDate).toBeNull();
        expect(read.patient.age).toBeNull();
    });
});
