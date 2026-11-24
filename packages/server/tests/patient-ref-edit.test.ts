import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { isAppointmentRef, isPatientRef, normalizeRef } from '../src/util/ref.ts';
import { setupDatabase, sql, truncateAll } from './helpers/db.ts';
import { expectAppError } from './helpers/factories.ts';
import { expectTrpcError, startTestServer, type TestServer } from './helpers/trpc.ts';

let api: TestServer;

async function patient(name = 'Nadia Hassan') {
    return patientService.create({ name, phone: '01012345678', birthDate: '1990-01-01', custom: {} });
}

async function counterAt(next: number): Promise<void> {
    await settingsService.update({ patientRefNext: next });
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

describe('the format a patient ref takes', () => {
    test('accepts a plain number', () => {
        for (const ref of ['1', '7', '910', '100000']) expect(isPatientRef(ref)).toBe(true);
    });

    test('accepts the four-character code a patient from before numbering carries', () => {
        for (const ref of ['W5F5', 'ABCD', '2345', 'w5f5']) expect(isPatientRef(ref)).toBe(true);
    });

    test('refuses the ambiguous letters the alphabet leaves out', () => {
        for (const ref of ['W5F0', 'O123', 'WIF5', 'L23A']) expect(isPatientRef(ref)).toBe(false);
    });

    test('refuses an appointment ref, a leading zero, and anything else', () => {
        for (const ref of ['011224-W5F5', '007', '0', '', 'W5F', 'W5F55', '12 34', '-1']) {
            expect(isPatientRef(ref)).toBe(false);
        }
    });

    test('an appointment ref is DDMMYY-XXXX, and is not a patient ref', () => {
        expect(isAppointmentRef('011224-W5F5')).toBe(true);
        expect(isAppointmentRef('910')).toBe(false);
        expect(isPatientRef('011224-W5F5')).toBe(false);
    });

    test('is stored uppercase however it was typed', () => {
        expect(normalizeRef('  w5f5 ')).toBe('W5F5');
        expect(normalizeRef('910')).toBe('910');
    });
});

describe('editing a ref', () => {
    test('changes the number on the record', async () => {
        await counterAt(5000);
        const row = await patient();

        const updated = await patientService.updateRef({ id: row.id, ref: '910', editedBy: 'doctor' });

        expect(updated.ref).toBe('910');
        expect((await patientService.byId(row.id)).patient.ref).toBe('910');
    });

    test('stores a pre-numbering code uppercase', async () => {
        const row = await patient();

        const updated = await patientService.updateRef({ id: row.id, ref: 'w5f5', editedBy: 'doctor' });

        expect(updated.ref).toBe('W5F5');
    });

    test('finds the record by its corrected number afterwards', async () => {
        await counterAt(5000);
        const row = await patient();
        await patientService.updateRef({ id: row.id, ref: '910', editedBy: 'doctor' });

        const found = await patientService.search({ q: '910', limit: 25 });

        expect(found.map((p) => p.id)).toContain(row.id);
    });

    test('refuses a ref that is not a ref', async () => {
        const row = await patient();

        for (const bad of ['011224-W5F5', '007', 'W5F0', 'hello']) {
            await expectAppError(ERROR_CODE.PATIENT_REF_INVALID, () =>
                patientService.updateRef({ id: row.id, ref: bad, editedBy: 'doctor' }),
            );
        }
    });

    test('refuses a number another patient already has', async () => {
        await counterAt(5000);
        const first = await patient('Nadia Hassan');
        const second = await patient('Omar Fathy');

        await expectAppError(ERROR_CODE.PATIENT_REF_TAKEN, () =>
            patientService.updateRef({ id: second.id, ref: first.ref, editedBy: 'doctor' }),
        );

        expect((await patientService.byId(second.id)).patient.ref).toBe(second.ref);
    });

    test('refuses a number the sequence has still to hand out', async () => {
        await counterAt(5000);
        const row = await patient();

        await expectAppError(ERROR_CODE.PATIENT_REF_RESERVED, () =>
            patientService.updateRef({ id: row.id, ref: '9100', editedBy: 'doctor' }),
        );
    });

    test('refuses a ref on a patient who is not on file', async () => {
        await expectAppError(ERROR_CODE.NOT_FOUND, () =>
            patientService.updateRef({ id: Bun.randomUUIDv7(), ref: '910', editedBy: 'doctor' }),
        );
    });
});

describe('who may edit', () => {
    test('lets the secretary correct a ref and records her role', async () => {
        await counterAt(5000);
        const row = await patient();

        const moved = await patientService.updateRef({ id: row.id, ref: '713', editedBy: 'secretary' });

        expect(moved.ref).toBe('713');
        const [entry] = await patientService.refHistory(row.id);
        expect(entry?.editedBy).toBe('secretary');
    });
});

describe('the audit trail', () => {
    test('records the previous value, the new one, the editor and when', async () => {
        await counterAt(5000);
        const row = await patient();
        const before = new Date();

        await patientService.updateRef({ id: row.id, ref: '910', editedBy: 'doctor' });

        const [entry, ...rest] = await patientService.refHistory(row.id);

        expect(rest).toEqual([]);
        expect(entry?.previousRef).toBe(row.ref);
        expect(entry?.newRef).toBe('910');
        expect(entry?.editedBy).toBe('doctor');
        expect(entry?.editedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    test('keeps every correction, newest first', async () => {
        await counterAt(5000);
        const row = await patient();

        await patientService.updateRef({ id: row.id, ref: '910', editedBy: 'doctor' });
        await patientService.updateRef({ id: row.id, ref: '911', editedBy: 'doctor' });
        await patientService.updateRef({ id: row.id, ref: 'W5F5', editedBy: 'doctor' });

        const history = await patientService.refHistory(row.id);

        expect(history.map((e) => [e.previousRef, e.newRef])).toEqual([
            ['911', 'W5F5'],
            ['910', '911'],
            [row.ref, '910'],
        ]);
    });

    test('is empty for a record whose ref was never corrected', async () => {
        const row = await patient();

        expect(await patientService.refHistory(row.id)).toEqual([]);
    });

    test('does not record re-typing the ref the record already has', async () => {
        const row = await patient();

        const unchanged = await patientService.updateRef({ id: row.id, ref: row.ref, editedBy: 'doctor' });

        expect(unchanged.ref).toBe(row.ref);
        expect(await patientService.refHistory(row.id)).toEqual([]);
    });

    test('is written in the same transaction as the change', async () => {
        await counterAt(5000);
        const first = await patient('Nadia Hassan');
        const second = await patient('Omar Fathy');

        await patientService.updateRef({ id: second.id, ref: '910', editedBy: 'doctor' });
        await expectAppError(ERROR_CODE.PATIENT_REF_TAKEN, () =>
            patientService.updateRef({ id: first.id, ref: '910', editedBy: 'doctor' }),
        );

        expect(await patientService.refHistory(first.id)).toEqual([]);
        expect(await patientService.refHistory(second.id)).toHaveLength(1);
    });

    test('outlives the record it describes', async () => {
        await counterAt(5000);
        const row = await patient();
        await patientService.updateRef({ id: row.id, ref: '910', editedBy: 'doctor' });

        await patientService.delete(row.id);

        const kept = await sql<{ count: number }[]>`
            SELECT COUNT(*)::int AS count FROM ref_edits WHERE entity_id = ${row.id}
        `;
        expect(kept[0]?.count).toBe(1);
    });

    test('is still readable once the record is gone', async () => {
        await counterAt(5000);
        const row = await patient();
        await patientService.updateRef({ id: row.id, ref: '910', editedBy: 'doctor' });

        await patientService.delete(row.id);

        const history = await patientService.refHistory(row.id);
        expect(history.map((e) => [e.previousRef, e.newRef])).toEqual([[row.ref, '910']]);
        expect(await api.client.patient.refHistory.query({ id: row.id })).toHaveLength(1);
    });

    test('is empty for an id no record ever had, rather than a refusal', async () => {
        expect(await patientService.refHistory(Bun.randomUUIDv7())).toEqual([]);
    });
});

describe('over the API', () => {
    test('edits, and reads the trail back', async () => {
        await counterAt(5000);
        const row = await api.client.patient.create.mutate({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });

        const updated = await api.client.patient.updateRef.mutate({
            id: row.id,
            ref: '910',
            editedBy: 'doctor',
        });
        expect(updated.ref).toBe('910');

        const history = await api.client.patient.refHistory.query({ id: row.id });
        expect(history).toHaveLength(1);
        expect(history[0]?.previousRef).toBe(row.ref);
    });

    test('carries the refusals through as the codes the client switches on', async () => {
        await counterAt(5000);
        const row = await api.client.patient.create.mutate({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });

        await expectTrpcError(ERROR_CODE.PATIENT_REF_INVALID, 422, () =>
            api.client.patient.updateRef.mutate({ id: row.id, ref: '007', editedBy: 'doctor' }),
        );
        await expectTrpcError(ERROR_CODE.PATIENT_REF_RESERVED, 422, () =>
            api.client.patient.updateRef.mutate({ id: row.id, ref: '9100', editedBy: 'doctor' }),
        );
    });

    test('refuses a role the contract does not have', async () => {
        const row = await api.client.patient.create.mutate({
            name: 'Nadia Hassan',
            phone: '01012345678',
            birthDate: '1990-01-01',
            custom: {},
        });

        await expectTrpcError(ERROR_CODE.VALIDATION, 400, () =>
            // @ts-expect-error — not a ClientRole, which is the point.
            api.client.patient.updateRef.mutate({ id: row.id, ref: '910', editedBy: 'admin' }),
        );
    });
});
