import type { AppointmentStatus } from '@lustre/shared';
import { ERROR_CODE, type Role, seesPayments, viewOf, WS_EVENT } from '@lustre/shared';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import {
    appointmentProcedures,
    appointments,
    patients,
    payments,
    procedureTypes,
    refEdits,
    reminders,
    settings,
    visitProcedures,
    visits,
} from '../../db/schema.ts';
import { AppError, PG_ERROR, pgErrorCode } from '../../errors/AppError.ts';
import { normalizePhone, phoneSearchTerm } from '../../util/phone.ts';
import { isPatientRef, normalizeRef } from '../../util/ref.ts';
import { ageFromBirthDate } from '../../util/time.ts';
import { broadcast } from '../../ws/index.ts';
import type { Answers, QuestionnaireGap } from '../customQuestion/customQuestion.service.ts';
import { customQuestionService } from '../customQuestion/customQuestion.service.ts';
import { planOldPatientHistory, writeOldPatientHistory } from '../migration/migration.service.ts';
import { type PatientRequirements, settingsService } from '../settings/settings.service.ts';
import type {
    CreatePatientInput,
    OldPatientInput,
    PatientByPhoneInput,
    RecentPatientsInput,
    SearchPatientInput,
    UpdatePatientInput,
    UpdatePatientRefInput,
} from './patient.schema.ts';

export type PatientRow = typeof patients.$inferSelect;

type MinimalPatientInput = Omit<CreatePatientInput, 'custom'>;

export interface Patient extends PatientRow {
    age: number | null;
}

interface PatientHistoryProcedure {
    name: string;
    quantity: number;
    tooth: string | null;
}

interface PatientHistoryEntry {
    appointmentId: string;
    visitId: string | null;
    ref: string;
    startsAt: Date;
    status: AppointmentStatus;
    checkedInAt: Date | null;
    completedAt: Date | null;
    isOpeningBalance: boolean;
    isImported: boolean;
    dateUnknown: boolean;
    computedTotal: number | null;
    chargedTotal: number | null;
    paidTotal: number | null;
    balance: number | null;
    procedures: PatientHistoryProcedure[];
}

interface PatientDetail {
    patient: Patient;
    history: PatientHistoryEntry[];
    questionnaireGaps: QuestionnaireGap[];
}

interface RecentPatients {
    patients: Patient[];
    total: number;
}

export const REF_EDIT_ENTITY = { PATIENT: 'patient', APPOINTMENT: 'appointment' } as const;

export interface RefEdit {
    previousRef: string;
    newRef: string;
    editedBy: string;
    editedAt: Date;
}

export function toPatient(row: PatientRow): Patient {
    return { ...row, age: ageFromBirthDate(row.birthDate) };
}

async function insertPatientWithRef(
    executor: Executor,
    values: Omit<typeof patients.$inferInsert, 'id' | 'ref'>,
    oldRef?: string,
): Promise<PatientRow> {
    return executor.transaction(async (tx) => {
        let ref: string;
        if (oldRef === undefined) {
            ref = String(await nextPatientRef(tx));
        } else {
            await assertOldRefUnreserved(tx, oldRef);
            ref = oldRef;
        }

        try {
            const [row] = await tx
                .insert(patients)
                .values({ ...values, id: Bun.randomUUIDv7(), ref })
                .returning();

            if (!row) throw AppError.internal('patient insert returned nothing');
            return row;
        } catch (err) {
            if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && isRefCollision(err)) {
                if (oldRef !== undefined) {
                    throw new AppError(
                        ERROR_CODE.PATIENT_REF_TAKEN,
                        'another patient already has that number',
                        409,
                        { cause: err },
                    );
                }
                throw new AppError(
                    ERROR_CODE.REF_GENERATION_FAILED,
                    'the next patient ref is already taken',
                    409,
                    { cause: err },
                );
            }
            throw err;
        }
    });
}

function ageRequired(): AppError {
    return new AppError(ERROR_CODE.AGE_REQUIRED, 'this clinic requires an age on every patient', 422);
}

function genderRequired(): AppError {
    return new AppError(ERROR_CODE.GENDER_REQUIRED, 'this clinic requires a sex on every patient', 422);
}

function isBlank(value: string | null | undefined): boolean {
    return value === null || value === undefined || value.trim() === '';
}

async function assertRegistrable(
    details: { birthDate?: string | null; gender?: string | null },
    executor: Executor = db,
): Promise<void> {
    const requires = await settingsService.patientRequirements(executor);
    if (requires.requireAge && isBlank(details.birthDate)) throw ageRequired();
    if (requires.requireGender && isBlank(details.gender)) throw genderRequired();
}

function assertNotCleared(
    patch: { birthDate?: string | null; gender?: string | null },
    requires: PatientRequirements,
): void {
    if (requires.requireAge && patch.birthDate !== undefined && isBlank(patch.birthDate)) throw ageRequired();
    if (requires.requireGender && patch.gender !== undefined && isBlank(patch.gender)) throw genderRequired();
}

async function nextPatientRef(executor: Executor): Promise<number> {
    const take = () =>
        executor
            .update(settings)
            .set({ patientRefNext: sql`${settings.patientRefNext} + 1` })
            .where(eq(settings.id, 1))
            .returning({ next: settings.patientRefNext });

    let [counter] = await take();
    if (!counter) {
        await settingsService.ensureSeeded();
        [counter] = await take();
    }

    if (!counter) throw AppError.internal('settings row could not be seeded');
    return counter.next - 1;
}

async function assertOldRefUnreserved(tx: Executor, oldRef: string): Promise<void> {
    if (!/^\d+$/.test(oldRef)) return;

    const read = () =>
        tx.select({ next: settings.patientRefNext }).from(settings).where(eq(settings.id, 1)).for('update');

    let [row] = await read();
    if (!row) {
        await settingsService.ensureSeeded();
        [row] = await read();
    }

    if (!row) throw AppError.internal('settings row could not be seeded');

    if (Number(oldRef) >= row.next) {
        throw new AppError(
            ERROR_CODE.PATIENT_REF_RESERVED,
            `${oldRef} is at or above the next patient number (${row.next}) and is not yet a patient's`,
            422,
        );
    }
}

function isRefCollision(err: unknown): boolean {
    for (let depth = 0; depth < 5 && err && typeof err === 'object'; depth += 1) {
        if ('constraint_name' in err && err.constraint_name === 'patients_ref_unique') return true;
        if ('constraint' in err && err.constraint === 'patients_ref_unique') return true;
        err = (err as { cause?: unknown }).cause;
    }
    return false;
}

function answersOf(row: PatientRow): Answers {
    return (row.custom ?? {}) as Answers;
}

function isPresent<T>(value: T | null): value is T {
    return value !== null;
}

async function proceduresByVisit(visitIds: string[]): Promise<Map<string, PatientHistoryProcedure[]>> {
    if (visitIds.length === 0) return new Map();

    const rows = await db
        .select({
            key: visitProcedures.visitId,
            name: procedureTypes.name,
            quantity: visitProcedures.quantity,
            tooth: visitProcedures.tooth,
        })
        .from(visitProcedures)
        .innerJoin(procedureTypes, eq(procedureTypes.id, visitProcedures.procedureId))
        .where(inArray(visitProcedures.visitId, visitIds));

    return group(rows);
}

async function proceduresByAppointment(
    appointmentIds: string[],
): Promise<Map<string, PatientHistoryProcedure[]>> {
    if (appointmentIds.length === 0) return new Map();

    const rows = await db
        .select({
            key: appointmentProcedures.appointmentId,
            name: procedureTypes.name,
            quantity: appointmentProcedures.quantity,
            tooth: appointmentProcedures.tooth,
        })
        .from(appointmentProcedures)
        .innerJoin(procedureTypes, eq(procedureTypes.id, appointmentProcedures.procedureId))
        .where(inArray(appointmentProcedures.appointmentId, appointmentIds))
        .orderBy(appointmentProcedures.sortOrder);

    return group(rows);
}

function group(
    rows: Array<{ key: string; name: string; quantity: number; tooth: string | null }>,
): Map<string, PatientHistoryProcedure[]> {
    const grouped = new Map<string, PatientHistoryProcedure[]>();
    for (const { key, ...procedure } of rows) {
        const bucket = grouped.get(key);
        if (bucket) bucket.push(procedure);
        else grouped.set(key, [procedure]);
    }
    return grouped;
}

async function requireRow(id: string): Promise<PatientRow> {
    const [row] = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
    if (!row) throw AppError.notFound('patient');
    return row;
}

const newestFirst = [desc(patients.createdAt), desc(patients.id)];
const byName = [asc(patients.name), asc(patients.id)];

export const patientService = {
    async search(input: SearchPatientInput): Promise<Patient[]> {
        const term = input.q.trim();
        if (!term) return [];

        const phoneTerm = phoneSearchTerm(term);

        const rows = await db
            .select()
            .from(patients)
            .where(
                or(
                    ilike(patients.name, `%${term}%`),
                    ...(phoneTerm ? [ilike(patients.phone, `%${phoneTerm}%`)] : []),
                    ilike(patients.ref, `%${term}%`),
                    ilike(patients.legacyRef, `%${term}%`),
                ),
            )
            .orderBy(...newestFirst)
            .limit(input.limit)
            .offset(input.offset ?? 0);

        return rows.map(toPatient);
    },

    async byPhone(input: PatientByPhoneInput): Promise<Patient[]> {
        let phone: string;
        try {
            phone = normalizePhone(input.phone);
        } catch {
            return [];
        }

        const rows = await db
            .select()
            .from(patients)
            .where(eq(patients.phone, phone))
            .orderBy(asc(patients.createdAt));

        return rows.map(toPatient);
    },

    async recent(input: RecentPatientsInput): Promise<RecentPatients> {
        const rows = await db
            .select()
            .from(patients)
            .orderBy(...(input.order === 'name' ? byName : newestFirst))
            .limit(input.limit)
            .offset(input.offset ?? 0);

        const [counted] = await db.select({ total: sql<number>`COUNT(*)::int` }).from(patients);

        return { patients: rows.map(toPatient), total: counted?.total ?? 0 };
    },

    async byId(id: string, viewer?: Role | null): Promise<PatientDetail> {
        const patient = await requireRow(id);

        const paid = db
            .select({
                visitId: payments.visitId,
                paidTotal: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`.as('paid_total'),
            })
            .from(payments)
            .groupBy(payments.visitId)
            .as('paid');

        const rows = await db
            .select({
                appointmentId: appointments.id,
                visitId: visits.id,
                ref: appointments.ref,
                startsAt: appointments.startsAt,
                status: appointments.status,
                isOpeningBalance: appointments.isOpeningBalance,
                isImported: appointments.isImported,
                dateUnknown: appointments.dateUnknown,
                checkedInAt: visits.checkedInAt,
                completedAt: visits.completedAt,
                computedTotal: visits.computedTotal,
                chargedTotal: visits.chargedTotal,
                paidTotal: sql<number>`COALESCE(${paid.paidTotal}, 0)::int`,
            })
            .from(appointments)
            .leftJoin(visits, eq(visits.appointmentId, appointments.id))
            .leftJoin(paid, eq(paid.visitId, visits.id))
            .where(eq(appointments.patientId, id))
            .orderBy(desc(appointments.startsAt));

        const performed = await proceduresByVisit(rows.map((r) => r.visitId).filter(isPresent));
        const planned = await proceduresByAppointment(
            rows.filter((r) => r.visitId === null).map((r) => r.appointmentId),
        );

        const shown = viewer === undefined || seesPayments(viewer);

        return {
            patient: toPatient(patient),
            history: rows.map((r) => {
                const chargedTotal = r.chargedTotal ?? 0;
                const paidTotal = r.paidTotal ?? 0;
                const past = r.completedAt !== null || r.isImported || r.isOpeningBalance;
                const priced = shown || !past;
                return {
                    ...r,
                    computedTotal: priced ? (r.computedTotal ?? 0) : null,
                    chargedTotal: priced ? chargedTotal : null,
                    paidTotal: shown ? paidTotal : null,
                    balance: shown ? chargedTotal - paidTotal : null,
                    procedures: (r.visitId ? performed.get(r.visitId) : planned.get(r.appointmentId)) ?? [],
                };
            }),
            questionnaireGaps: await customQuestionService.auditAnswers(answersOf(patient)),
        };
    },

    async create(input: CreatePatientInput): Promise<Patient> {
        await assertRegistrable(input);
        const custom = await customQuestionService.validateIntake(input.custom);

        const values = {
            name: input.name,
            phone: normalizePhone(input.phone),
            email: input.email ?? null,
            birthDate: input.birthDate ?? null,
            gender: input.gender ?? null,
            custom,
            notes: input.notes ?? null,
            legacyRef: input.legacyRef ?? null,
        };

        if (input.old === undefined) {
            const inserted = await insertPatientWithRef(db, values);
            broadcast(WS_EVENT.PATIENT_UPDATED, { id: inserted.id });
            return toPatient(inserted);
        }

        const old: OldPatientInput = input.old;
        const plan = await planOldPatientHistory(old);

        const row = await db.transaction(async (tx) => {
            const inserted = await insertPatientWithRef(tx, { ...values, legacyRef: old.ref }, old.ref);
            if (plan) await writeOldPatientHistory(tx, inserted.id, plan);
            return inserted;
        });

        broadcast(WS_EVENT.PATIENT_UPDATED, { id: row.id });
        return toPatient(row);
    },

    async update({ id, ...patch }: UpdatePatientInput): Promise<Patient> {
        const current = await requireRow(id);
        assertNotCleared(patch, await settingsService.patientRequirements());

        const custom = patch.custom
            ? await customQuestionService.validatePatch(answersOf(current), patch.custom)
            : undefined;

        const [row] = await db
            .update(patients)
            .set({
                ...patch,
                ...(patch.phone === undefined ? {} : { phone: normalizePhone(patch.phone) }),
                ...(custom ? { custom } : {}),
            })
            .where(eq(patients.id, id))
            .returning();

        if (!row) throw AppError.notFound('patient');
        broadcast(WS_EVENT.PATIENT_UPDATED, { id });
        return toPatient(row);
    },

    async updateRef(
        { id, ref, editedBy: claimed }: UpdatePatientRefInput,
        caller?: Role | null,
    ): Promise<Patient> {
        const editedBy = caller ? viewOf(caller) : claimed;

        const next = normalizeRef(ref);
        if (!isPatientRef(next)) {
            throw new AppError(
                ERROR_CODE.PATIENT_REF_INVALID,
                'a patient ref is a plain number, or the four-character code a patient from before numbering carries',
                422,
            );
        }

        const row = await db.transaction(async (tx) => {
            const [current] = await tx
                .select()
                .from(patients)
                .where(eq(patients.id, id))
                .limit(1)
                .for('update');
            if (!current) throw AppError.notFound('patient');
            if (current.ref === next) return current;

            await assertOldRefUnreserved(tx, next);

            let updated: PatientRow | undefined;
            try {
                [updated] = await tx
                    .update(patients)
                    .set({ ref: next })
                    .where(eq(patients.id, id))
                    .returning();
            } catch (err) {
                if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && isRefCollision(err)) {
                    throw new AppError(
                        ERROR_CODE.PATIENT_REF_TAKEN,
                        'another patient already has that number',
                        409,
                        { cause: err },
                    );
                }
                throw err;
            }

            if (!updated) throw AppError.notFound('patient');

            await tx.insert(refEdits).values({
                id: Bun.randomUUIDv7(),
                entity: REF_EDIT_ENTITY.PATIENT,
                entityId: id,
                previousRef: current.ref,
                newRef: next,
                editedBy,
            });

            return updated;
        });

        broadcast(WS_EVENT.PATIENT_UPDATED, { id });
        return toPatient(row);
    },

    async refHistory(id: string): Promise<RefEdit[]> {
        return db
            .select({
                previousRef: refEdits.previousRef,
                newRef: refEdits.newRef,
                editedBy: refEdits.editedBy,
                editedAt: refEdits.editedAt,
            })
            .from(refEdits)
            .where(and(eq(refEdits.entity, REF_EDIT_ENTITY.PATIENT), eq(refEdits.entityId, id)))
            .orderBy(desc(refEdits.editedAt));
    },

    async delete(id: string): Promise<void> {
        await db.transaction(async (tx) => {
            await requireRow(id);

            const [paid] = await tx
                .select({ id: payments.id })
                .from(payments)
                .innerJoin(visits, eq(visits.id, payments.visitId))
                .innerJoin(appointments, eq(appointments.id, visits.appointmentId))
                .where(eq(appointments.patientId, id))
                .limit(1);
            if (paid) {
                throw new AppError(ERROR_CODE.HAS_PAYMENTS, 'this patient has payments recorded', 409);
            }

            const owned = tx
                .select({ id: appointments.id })
                .from(appointments)
                .where(eq(appointments.patientId, id));
            await tx.delete(reminders).where(inArray(reminders.appointmentId, owned));
            await tx.delete(visits).where(inArray(visits.appointmentId, owned));
            await tx.delete(appointments).where(eq(appointments.patientId, id));
            await tx.delete(patients).where(eq(patients.id, id));
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id });
    },

    async createMinimal(input: MinimalPatientInput, executor: Executor = db): Promise<PatientRow> {
        await assertRegistrable(input, executor);
        return insertPatientWithRef(executor, {
            name: input.name,
            phone: normalizePhone(input.phone),
            email: input.email ?? null,
            birthDate: input.birthDate ?? null,
            gender: input.gender ?? null,
            notes: input.notes ?? null,
            legacyRef: input.legacyRef ?? null,
        });
    },

    async requireExists(id: string): Promise<PatientRow> {
        return requireRow(id);
    },
};
