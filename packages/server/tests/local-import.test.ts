import { Database } from 'bun:sqlite';
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
    DEFAULT_REMINDER_TEMPLATE,
    ERROR_CODE,
    LOCAL_CLINIC_FORMAT,
    LOCAL_CLINIC_TABLES_SQL,
    LOCAL_CLINIC_VERSION,
} from '@lustre/shared';
import { balanceService } from '../src/modules/balance/balance.service.ts';
import { branchService } from '../src/modules/branch/branch.service.ts';
import { importLocalClinic, parseLocalClinicFile } from '../src/modules/migration/localImport.ts';
import { procedureService } from '../src/modules/procedure/procedure.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { insertPatient, setupDatabase, sql, truncateAll, uuid } from './helpers/db.ts';
import { expectAppError } from './helpers/factories.ts';

/**
 * A clinic that ran on one phone, moved onto a server. The file is built the
 * way the phone writes it — `JSON.stringify` over rows whose timestamps are
 * `Date`s — and what is asserted is what the clinic would check first: the
 * patients are there under their numbers, what they owe is what they owed, and
 * the clinic's own setup came with them. The refusals matter as much: a server
 * that already has a clinic is never merged into, and a file that fails part
 * way leaves nothing behind.
 */

const CHARGED = 150_000;
const PAID = 50_000;
const COST = 20_000;

function phoneClinic() {
    const branchId = uuid();
    const parentId = uuid();
    const childId = uuid();
    const patientId = uuid();
    const appointmentId = uuid();
    const visitId = uuid();
    const at = new Date('2026-09-20T09:00:00.000Z');

    const db = {
        branches: [{ id: branchId, name: 'Main', address: null, active: true, whatsappApp: 'regular' }],
        clinicDays: [{ weekday: 0, branchId, opensAt: '10:00', closesAt: '20:00' }],
        patients: [
            {
                id: patientId,
                ref: '1',
                name: 'Salma Adel',
                phone: '01011112222',
                email: null,
                birthDate: '1988-04-02',
                gender: null,
                custom: {},
                notes: null,
                legacyRef: null,
                createdAt: at,
            },
        ],
        procedureTypes: [
            // The subtype first, as an array on a phone has no reason to order them.
            {
                id: childId,
                parentId,
                name: 'Composite',
                defaultPrice: CHARGED,
                cost: COST,
                hasQuantity: false,
                isToothSpecific: false,
                isCheckup: false,
                active: true,
                sortOrder: 0,
            },
            {
                id: parentId,
                parentId: null,
                name: 'Fillings',
                defaultPrice: 0,
                cost: 0,
                hasQuantity: false,
                isToothSpecific: false,
                isCheckup: false,
                active: true,
                sortOrder: 0,
            },
        ],
        appointments: [
            {
                id: appointmentId,
                ref: '200926-ABCD',
                patientId,
                branchId,
                startsAt: at,
                durationMinutes: 30,
                note: null,
                status: 'done',
                channel: 'desk',
                labStatus: null,
                isOpeningBalance: false,
                isImported: false,
                dateUnknown: false,
                createdAt: at,
                updatedAt: at,
            },
        ],
        appointmentProcedures: [],
        visits: [
            {
                id: visitId,
                appointmentId,
                checkedInAt: at,
                inChairAt: at,
                pricedAt: at,
                completedAt: at,
                computedTotal: CHARGED,
                chargedTotal: CHARGED,
                nextProcedures: [{ procedureId: childId, tooth: null }],
                nextAppointmentId: null,
                createdAt: at,
            },
        ],
        visitProcedures: [
            {
                id: uuid(),
                visitId,
                procedureId: childId,
                quantity: 1,
                unitPrice: CHARGED,
                unitCost: COST,
                tooth: null,
                note: null,
            },
        ],
        payments: [{ id: uuid(), visitId, amount: PAID, method: 'cash', methodNote: null, paidAt: at }],
        customQuestions: [],
        reminders: [],
        refEdits: [],
        roleGrants: [],
        devices: [],
        settings: {
            clinicName: 'Phone Clinic',
            clinicPhone: null,
            durationOptions: [15, 30, 60],
            defaultDuration: 30,
            reminderLeadHours: 24,
            reminderNotifyAt: '18:00',
            reminderRepeatMinutes: 30,
            reminderDismissedOn: null,
            reminderTemplate: DEFAULT_REMINDER_TEMPLATE,
            patientRefNext: 2,
            requireAge: true,
            requireGender: false,
            askToEditOnFinish: true,
            clinicType: 'general',
            requireProvisioning: false,
            updatedAt: at,
        },
    };
    return { patientId, db };
}

/** The file as the phone writes it: gzipped SQLite, a row per record. */
function fileOf(db: object, version: number = LOCAL_CLINIC_VERSION): Uint8Array {
    const snapshot = new Database(':memory:');
    snapshot.exec(LOCAL_CLINIC_TABLES_SQL);
    const insert = snapshot.query('INSERT INTO clinic_rows (tbl, id, json) VALUES (?, ?, ?)');
    for (const [table, value] of Object.entries(db)) {
        const rows: unknown[] = Array.isArray(value) ? value : [value];
        rows.forEach((row, index) => {
            insert.run(table, String(index), JSON.stringify(row));
        });
    }
    const meta = snapshot.query('INSERT INTO clinic_meta (key, value) VALUES (?, ?)');
    meta.run('format', LOCAL_CLINIC_FORMAT);
    meta.run('version', String(version));
    return Bun.gzipSync(new Uint8Array(snapshot.serialize()));
}

async function count(table: 'patients' | 'appointments' | 'payments'): Promise<number> {
    const [row] = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`);
    return row?.n ?? 0;
}

describe('importing a clinic kept on one phone', () => {
    beforeAll(setupDatabase);
    beforeEach(truncateAll);

    test('brings the patients, what they owe and the clinic setup across', async () => {
        const { patientId, db } = phoneClinic();

        const summary = await importLocalClinic(parseLocalClinicFile(fileOf(db)));

        expect(summary).toMatchObject({ patients: 1, appointments: 1, visits: 1, payments: 1 });
        const owed = await balanceService.outstanding([patientId]);
        expect(owed.total).toBe(CHARGED - PAID);
        const [line] = await sql<{ unit_cost: number }[]>`SELECT unit_cost FROM visit_procedures`;
        expect(line?.unit_cost).toBe(COST);
        const next = await sql`SELECT procedure_id FROM visit_next_procedures`;
        expect(next).toHaveLength(1);
        const settings = await settingsService.get();
        expect(settings).toMatchObject({
            clinicName: 'Phone Clinic',
            patientRefNext: 2,
            clinicType: 'general',
        });
        const tree = await procedureService.tree({ includeInactive: true });
        expect(tree.map((node) => [node.name, node.children.map((child) => child.name)])).toEqual([
            ['Fillings', ['Composite']],
        ]);
    });

    test('replaces the setup a fresh server already had, and keeps its role-code rule', async () => {
        await branchService.create({ name: 'Server default' });
        await settingsService.setRequireProvisioning(true);

        await importLocalClinic(parseLocalClinicFile(fileOf(phoneClinic().db)));

        const branches = await branchService.list({ includeInactive: true });
        expect(branches.map((branch) => branch.name)).toEqual(['Main']);
        expect((await settingsService.get()).requireProvisioning).toBe(true);
    });

    test('refuses a server that already holds patients, and writes nothing', async () => {
        await insertPatient();

        await expectAppError(ERROR_CODE.VALIDATION, () =>
            importLocalClinic(parseLocalClinicFile(fileOf(phoneClinic().db))),
        );

        expect(await count('patients')).toBe(1);
        expect(await count('appointments')).toBe(0);
    });

    test('refuses a file that is not a clinic this server reads', async () => {
        const { db } = phoneClinic();
        const { settings: _, ...missingSettings } = db;

        for (const raw of [
            new TextEncoder().encode(JSON.stringify({ format: LOCAL_CLINIC_FORMAT, version: 1, db })),
            Bun.gzipSync(new TextEncoder().encode('not a database')),
            fileOf(db).slice(0, 40),
            fileOf(db, 99),
            fileOf(missingSettings),
            fileOf({ ...db, invoices: [{}] }),
            fileOf({ ...db, payments: [{ ...db.payments[0], amount: 12.5 }] }),
        ]) {
            await expectAppError(ERROR_CODE.VALIDATION, async () => parseLocalClinicFile(raw));
        }
    });

    test('leaves nothing behind when a row is refused part way', async () => {
        const { db } = phoneClinic();
        const orphan = { ...db, payments: [{ ...db.payments[0], visitId: uuid() }] };

        await expect(importLocalClinic(parseLocalClinicFile(fileOf(orphan)))).rejects.toThrow();

        expect(await count('patients')).toBe(0);
        expect(await count('appointments')).toBe(0);
        expect(await count('payments')).toBe(0);
    });
});
