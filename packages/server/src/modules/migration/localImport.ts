/**
 * A clinic that ran on one phone (the app's local mode), moved onto this
 * server: the file the phone exports, written into an empty clinic in one
 * transaction. Reachable from `scripts/import-local.ts` and nowhere else — it
 * replaces the clinic's setup wholesale, which is an operator's act on the
 * server and not something a phone should be able to send.
 *
 * "Empty" is no patients and no appointments. Branches, hours, the catalogue
 * and the patient fields a fresh server may already hold are replaced by the
 * phone's, since nothing points at them yet. The phones and role codes are the
 * server's and stay: the phone's credential means nothing here, so whoever
 * moved the clinic issues the first admin with `lustre grant admin` as usual.
 */
import { ERROR_CODE, type LocalClinicFile, localClinicFileSchema } from '@lustre/shared';
import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db, type Executor } from '../../db/index.ts';
import {
    appointmentProcedures,
    appointments,
    branches,
    clinicDays,
    customQuestions,
    patients,
    payments,
    procedureTypes,
    refEdits,
    reminders,
    settings,
    visitNextProcedures,
    visitProcedures,
    visits,
} from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';

/** Well under Postgres's 65,535 bind parameters for the widest table here. */
const CHUNK = 500;

export interface LocalImportSummary {
    branches: number;
    procedures: number;
    patients: number;
    appointments: number;
    visits: number;
    payments: number;
}

export function parseLocalClinicFile(raw: string): LocalClinicFile {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        throw new AppError(ERROR_CODE.VALIDATION, 'the clinic file is not JSON');
    }
    const parsed = localClinicFileSchema.safeParse(json);
    if (!parsed.success) {
        const where = parsed.error.issues[0]?.path.join('.') || 'the file';
        throw new AppError(
            ERROR_CODE.VALIDATION,
            `the clinic file is not one this server reads (at ${where})`,
        );
    }
    return parsed.data;
}

async function insertAll<T extends PgTable>(executor: Executor, table: T, rows: T['$inferInsert'][]) {
    for (let start = 0; start < rows.length; start += CHUNK) {
        await executor.insert(table).values(rows.slice(start, start + CHUNK));
    }
}

/** Parents before their subtypes, or the self-reference refuses the child. */
function parentsFirst<T extends { parentId: string | null }>(rows: T[]): T[] {
    return [...rows.filter((row) => row.parentId === null), ...rows.filter((row) => row.parentId !== null)];
}

export async function importLocalClinic(file: LocalClinicFile): Promise<LocalImportSummary> {
    const clinic = file.db;

    await db.transaction(async (tx) => {
        // A phone registering a patient while this runs would make the clinic
        // not empty after the check below has said it was.
        await tx.execute(sql`LOCK TABLE patients, appointments IN SHARE ROW EXCLUSIVE MODE`);
        const [held] = await tx.execute<{ patients: number; appointments: number }>(sql`
            SELECT (SELECT count(*) FROM patients)::int AS patients,
                   (SELECT count(*) FROM appointments)::int AS appointments
        `);
        if (held && (held.patients > 0 || held.appointments > 0)) {
            throw new AppError(
                ERROR_CODE.VALIDATION,
                `this server already holds a clinic (${held.patients} patients, ${held.appointments} appointments); import into an empty one`,
            );
        }

        await tx.delete(clinicDays);
        await tx.delete(branches);
        await tx.delete(procedureTypes);
        await tx.delete(customQuestions);

        await insertAll(tx, branches, clinic.branches);
        await insertAll(tx, clinicDays, clinic.clinicDays);
        await insertAll(tx, procedureTypes, parentsFirst(clinic.procedureTypes));
        await insertAll(tx, customQuestions, clinic.customQuestions);
        await insertAll(tx, patients, clinic.patients);
        await insertAll(tx, appointments, clinic.appointments);
        await insertAll(tx, appointmentProcedures, clinic.appointmentProcedures);
        await insertAll(
            tx,
            visits,
            clinic.visits.map(({ nextProcedures: _, ...visit }) => visit),
        );
        await insertAll(
            tx,
            visitNextProcedures,
            clinic.visits.flatMap((visit) =>
                visit.nextProcedures.map((next, sortOrder) => ({
                    id: Bun.randomUUIDv7(),
                    visitId: visit.id,
                    ...next,
                    sortOrder,
                })),
            ),
        );
        await insertAll(tx, visitProcedures, clinic.visitProcedures);
        await insertAll(tx, payments, clinic.payments);
        await insertAll(tx, reminders, clinic.reminders);
        await insertAll(tx, refEdits, clinic.refEdits);

        // Whether a phone needs a role code is about this server's phones, not
        // the one the clinic came from, so the server's own answer stays.
        const { requireProvisioning: _, ...setup } = clinic.settings;
        const values = { ...setup, updatedAt: new Date() };
        await tx
            .insert(settings)
            .values({ id: 1, ...values })
            .onConflictDoUpdate({ target: settings.id, set: values });
    });

    return {
        branches: clinic.branches.length,
        procedures: clinic.procedureTypes.length,
        patients: clinic.patients.length,
        appointments: clinic.appointments.length,
        visits: clinic.visits.length,
        payments: clinic.payments.length,
    };
}
