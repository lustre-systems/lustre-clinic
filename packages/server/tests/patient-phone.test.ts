import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { phoneSearchTerm } from '../src/util/phone.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { startTestServer, type TestServer } from './helpers/trpc.ts';

const SHARED = '01012345678';
const OTHER = '01198765432';

let api: TestServer;

async function family() {
    const mother = await patientService.create({
        name: 'Mona Adel',
        phone: SHARED,
        birthDate: '1990-01-01',
        custom: {},
    });
    const son = await patientService.create({
        name: 'Adel Mahmoud',
        phone: SHARED,
        birthDate: '1990-01-01',
        custom: {},
    });
    const daughter = await patientService.create({
        name: 'Salma Mahmoud',
        phone: SHARED,
        birthDate: '1990-01-01',
        custom: {},
    });
    const stranger = await patientService.create({
        name: 'Hani Farouk',
        phone: OTHER,
        birthDate: '1990-01-01',
        custom: {},
    });

    return { mother, son, daughter, stranger };
}

beforeAll(async () => {
    await setupDatabase();
    api = startTestServer();
});

afterAll(() => {
    api.stop();
});

beforeEach(async () => {
    await truncateAll();
});

describe('one number on several records', () => {
    test('registers every patient on a shared number', async () => {
        const { mother, son, daughter } = await family();

        expect(new Set([mother.id, son.id, daughter.id]).size).toBe(3);
        for (const patient of [mother, son, daughter]) {
            expect(patient.phone).toBe('+201012345678');
        }
    });

    test('is refused nothing over the API either', async () => {
        await api.client.patient.create.mutate({
            name: 'Mona Adel',
            phone: SHARED,
            birthDate: '1990-01-01',
            custom: {},
        });
        const second = await api.client.patient.create.mutate({
            name: 'Adel Mahmoud',
            phone: SHARED,
            birthDate: '1990-01-01',
            custom: {},
        });

        expect(second.phone).toBe('+201012345678');
    });

    test('moves an existing record onto a number another record already has', async () => {
        const { stranger } = await family();

        const moved = await patientService.update({ id: stranger.id, phone: SHARED });

        expect(moved.phone).toBe('+201012345678');
        expect(await patientService.byPhone({ phone: SHARED })).toHaveLength(4);
    });

    test('still refuses a number that is not a number', async () => {
        await expect(
            patientService.create({
                name: 'Nobody',
                phone: 'not a phone',
                birthDate: '1990-01-01',
                custom: {},
            }),
        ).rejects.toThrow(/valid E.164/);
    });
});

describe('byPhone', () => {
    test('answers with every patient on the number, oldest first', async () => {
        const { mother, son, daughter } = await family();

        const found = await patientService.byPhone({ phone: SHARED });

        expect(found.map((p) => p.id)).toEqual([mother.id, son.id, daughter.id]);
    });

    test('matches on the normalized form, whichever form was typed', async () => {
        await family();

        for (const typed of [SHARED, '+201012345678', '00201012345678', ' (010) 1234-5678 ']) {
            expect(await patientService.byPhone({ phone: typed })).toHaveLength(3);
        }
    });

    test('answers [] for a term still being typed rather than refusing it', async () => {
        await family();

        expect(await patientService.byPhone({ phone: '0101' })).toEqual([]);
    });
});

describe('search by number', () => {
    test('returns every patient on a whole number', async () => {
        const { mother, son, daughter, stranger } = await family();

        const found = await patientService.search({ q: SHARED, limit: 25 });

        expect(found.map((p) => p.id).sort()).toEqual([mother.id, son.id, daughter.id].sort());
        expect(found.map((p) => p.id)).not.toContain(stranger.id);
    });

    test('returns them for a number still being typed', async () => {
        await family();

        for (const partial of ['010123', '0101234', '+20101', '20101']) {
            expect(await patientService.search({ q: partial, limit: 25 })).toHaveLength(3);
        }
    });

    test('narrows rather than widens as more of the number is typed', async () => {
        await family();

        expect(await patientService.search({ q: '011987', limit: 25 })).toHaveLength(1);
    });

    test('still finds a patient by name and by ref', async () => {
        const { mother } = await family();

        expect((await patientService.search({ q: 'Mona', limit: 25 })).map((p) => p.id)).toEqual([mother.id]);
        expect((await patientService.search({ q: mother.ref, limit: 25 })).map((p) => p.id)).toContain(
            mother.id,
        );
    });
});

describe('phoneSearchTerm', () => {
    test('gives a whole number its stored form', () => {
        expect(phoneSearchTerm('01012345678')).toBe('+201012345678');
        expect(phoneSearchTerm('+201012345678')).toBe('+201012345678');
    });

    test('gives a partial local number the country code, without the +', () => {
        expect(phoneSearchTerm('0101')).toBe('20101');
        expect(phoneSearchTerm('00201')).toBe('201');
        expect(phoneSearchTerm('+2010')).toBe('2010');
    });

    test('is null when there is no number in the term at all', () => {
        for (const term of ['', 'Mona', 'W5F5', '010-abc']) {
            expect(phoneSearchTerm(term)).toBeNull();
        }
    });
});

describe('reminders and display read the number on the record', () => {
    test('a corrected number reaches the reminder without anything else being touched', async () => {
        const { mother } = await family();

        const updated = await patientService.update({ id: mother.id, phone: OTHER });
        const { patient } = await patientService.byId(mother.id);

        expect(updated.phone).toBe('+201198765432');
        expect(patient.phone).toBe('+201198765432');
        expect(await patientService.byPhone({ phone: SHARED })).toHaveLength(2);
    });
});
