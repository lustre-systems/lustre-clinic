import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { balanceService } from '../src/modules/balance/balance.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { insertPatient, setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { type Clinic, clinic, todaySlot } from './helpers/factories.ts';
import { expectValidationError, startTestServer, type TestServer } from './helpers/trpc.ts';

let api: TestServer;

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

async function register(count: number, prefix = 'Page Patient'): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(await insertPatient(`${prefix} ${i}`));
    await sql`
        UPDATE patients SET created_at = '2026-01-01T09:00:00Z'
        WHERE id IN ${sql(ids.filter((_, i) => i % 2 === 0))}
    `;
    return ids;
}

async function walk<T extends { id: string }>(
    fetchPage: (offset: number) => Promise<T[]>,
    limit: number,
): Promise<string[]> {
    const seen: string[] = [];
    for (let offset = 0; ; offset += limit) {
        const page = await fetchPage(offset);
        seen.push(...page.map((row) => row.id));
        if (page.length < limit) return seen;
    }
}

describe('patient.recent — paging', () => {
    test('walks the whole register once, newest first, across created_at ties', async () => {
        const ids = await register(23);

        const seen = await walk(
            async (offset) => (await patientService.recent({ limit: 5, offset })).patients,
            5,
        );

        expect(seen).toHaveLength(23);
        expect(new Set(seen)).toEqual(new Set(ids));

        const everyone = await patientService.recent({ limit: 100, offset: 0 });
        expect(everyone.patients.map((row) => row.id)).toEqual(seen);
    });

    test('counts the register on every page, not the page', async () => {
        await register(7);

        const last = await patientService.recent({ limit: 5, offset: 5 });

        expect(last.patients).toHaveLength(2);
        expect(last.total).toBe(7);
    });

    test('past the end is an empty page, not an error', async () => {
        await register(3);

        expect((await patientService.recent({ limit: 5, offset: 10 })).patients).toEqual([]);
    });

    test('defaults to the first page over the API', async () => {
        await register(30);

        const first = await api.client.patient.recent.query({});

        expect(first.patients).toHaveLength(25);
        expect(first.total).toBe(30);
    });

    test('refuses a negative offset', async () => {
        await expectValidationError(() => api.client.patient.recent.query({ offset: -1 }));
    });
});

describe('patient.search — paging', () => {
    test('reaches every match past the first page, and only matches', async () => {
        const matches = await register(12, 'Samir');
        await register(4, 'Hoda');

        const seen = await walk((offset) => patientService.search({ q: 'samir', limit: 5, offset }), 5);

        expect(seen).toHaveLength(12);
        expect(new Set(seen)).toEqual(new Set(matches));
    });

    test('still answers a bare array, as the booking typeahead reads it', async () => {
        await register(10, 'Samir');

        const rows = await api.client.patient.search.query({ q: 'samir', limit: 8 });

        expect(Array.isArray(rows)).toBe(true);
        expect(rows).toHaveLength(8);
    });

    test('refuses a negative offset', async () => {
        await expectValidationError(() => api.client.patient.search.query({ q: 'a', offset: -1 }));
    });
});

async function owes(f: Clinic, patientId: string, startsAt: string, amount: number): Promise<void> {
    const appointment = await appointmentService.create({
        patient: { kind: 'existing', patientId },
        branchId: f.branch.id,
        startsAt,
        offsetMinutes: 0,
        procedures: [{ procedureId: f.rootCanal.id, quantity: 1 }],
    });
    const visit = await visitService.checkIn({ appointmentId: appointment.id });
    await visitService.checkOut({ visitId: visit.id, chargedTotal: amount, paidTotal: 0, method: 'cash' });
}

describe('balance.outstanding — one page of patients', () => {
    test('answers only for the patients asked about', async () => {
        const f = await clinic();
        const other = await patientService.create({
            name: 'Omar Said',
            phone: '01198765432',
            birthDate: '1990-01-01',
            custom: {},
        });
        await owes(f, f.patient.id, todaySlot(), 100_000);
        await owes(f, other.id, todaySlot(60), 50_000);

        const page = await balanceService.outstanding([other.id]);

        expect(page.patients.map((row) => [row.patientId, row.balance])).toEqual([[other.id, 50_000]]);
        expect(page.total).toBe(50_000);
        expect((await balanceService.outstanding()).patients).toHaveLength(2);
        expect(await balanceService.outstanding([])).toEqual({ total: 0, patients: [] });
    });
});
