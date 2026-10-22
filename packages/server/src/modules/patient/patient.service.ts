/**
 * SPEC §5, §13. Phone is normalized to E.164 on write; age is derived at read
 * time and never stored.
 *
 * `byId` returns the patient and their whole history in one payload (§13), so
 * the records screen is a single round trip. That history is over appointments
 * rather than visits — see the method.
 *
 * Search uses a trigram-free substring `ILIKE` deliberately — thousands of
 * patients, not millions — and normalizes the phone term first so `0101…`
 * finds `+20101…`. `create` validates the full questionnaire (a new record is
 * the form answered in one sitting), while `update` merges a partial `custom`
 * patch and does not re-check answers the caller left out. `createMinimal`
 * (used by appointment booking) takes whatever of the record the booking
 * collected and deliberately skips questionnaire validation — the secretary is
 * on the phone, and the questions are answered at the desk.
 *
 * ## Numbering, and old patients
 *
 * A *new* patient is numbered off `settings.patient_ref_next` — handed that
 * number as it stands, which is then moved on by one, in the same transaction
 * as the insert.
 *
 * An **old** patient is not numbered at all. They arrived with a number written
 * on their paper file and that number is their `ref`, so the desk is given one
 * number for them rather than being shown a fresh one and told the real one is
 * elsewhere. `legacy_ref` carries the same string, which is what marks the
 * record as having come across. Two consequences the code has to enforce:
 * registering one must not consume the number the next new patient is owed, and
 * an old number that is a plain digit string the sequence has still to reach is
 * refused — taking it would hand the same number to two patients later.
 *
 * A ref that is already on a record can be corrected afterwards — see
 * `updateRef`, which is the only path that writes one, and which leaves a row
 * in `ref_edits` every time it does.
 */
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

/** What a booking knows about a patient it is creating — `createPatientInput` less the questionnaire. */
type MinimalPatientInput = Omit<CreatePatientInput, 'custom'>;

export interface Patient extends PatientRow {
    age: number | null;
}

/** What was done, or — when the patient never got to the chair — what was going to be. */
interface PatientHistoryProcedure {
    name: string;
    quantity: number;
    tooth: string | null;
}

/**
 * One row of a patient's history: an appointment, and the visit it became if it
 * became one. A cancellation and a no-show never produce a visit and are still
 * part of the history a record is read for, so the row is keyed by the
 * appointment and every visit-side field is nullable.
 */
interface PatientHistoryEntry {
    appointmentId: string;
    visitId: string | null;
    ref: string;
    startsAt: Date;
    status: AppointmentStatus;
    checkedInAt: Date | null;
    completedAt: Date | null;
    /** Debt carried over from the old system, not a visit. The record labels it rather than drawing it as one. */
    isOpeningBalance: boolean;
    /** Work the old system recorded. No visit behind it, so no money on it — the record marks it as prior history. */
    isImported: boolean;
    /** The file did not say when. `startsAt` is the cutoff only because the column demands a value. */
    dateUnknown: boolean;
    /** Null, like the two below, for a viewer not shown payments, once the visit is past (see `Visit`). */
    computedTotal: number | null;
    chargedTotal: number | null;
    /** Null for a viewer who may not see payments (a doctor). */
    paidTotal: number | null;
    balance: number | null;
    procedures: PatientHistoryProcedure[];
}

interface PatientDetail {
    patient: Patient;
    history: PatientHistoryEntry[];
    questionnaireGaps: QuestionnaireGap[];
}

/**
 * One page of the register, and how many there are in total. `total` counts
 * the register, not the page — the list draws it beside its heading, so a second
 * round trip for one integer would be a wasted call over Tailscale.
 */
interface RecentPatients {
    patients: Patient[];
    total: number;
}

/**
 * Which kind of record a `ref_edits` row is about. Appointments carry refs too
 * (§5) and edit into the same table, so the column is not a patient id alone.
 */
export const REF_EDIT_ENTITY = { PATIENT: 'patient', APPOINTMENT: 'appointment' } as const;

/** One correction, as the record screen reads it back. */
export interface RefEdit {
    previousRef: string;
    newRef: string;
    editedBy: string;
    editedAt: Date;
}

/** Exported for callers that already hold the row rather than the shape a read returns. */
export function toPatient(row: PatientRow): Patient {
    return { ...row, age: ageFromBirthDate(row.birthDate) };
}

/**
 * The one way a patient row is written, so every registration path gets a `ref`
 * and none of them can forget one.
 *
 * `oldRef` is the number an old patient already has; without it the row is
 * numbered off the counter. Either way the number is settled and the row
 * inserted in one transaction (a savepoint when the caller is already in one,
 * as booking and the old-patient write both are). The counter's `UPDATE` takes
 * the settings row's lock, so a second registration waits for the first to
 * commit and reads its number, and a failed insert rolls the counter back with
 * it.
 *
 * An allocated ref that collides is not retried. Settings refuses a next number
 * at or below the highest ref on file, so a collision means a row was written
 * around the counter, and the next number would most likely collide too. An
 * *old* ref that collides is a different event entirely — the desk typed a
 * number another patient has — and says so.
 */
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

/** A sex typed as spaces is not one; the schema trims it to `''`. */
function isBlank(value: string | null | undefined): boolean {
    return value === null || value === undefined || value.trim() === '';
}

/**
 * Refuses a registration the clinic's settings say is incomplete. Checked in
 * the service, not by the schema or a column constraint, because the clinic
 * can turn either rule on or off (Settings → Patient fields).
 */
async function assertRegistrable(
    details: { birthDate?: string | null; gender?: string | null },
    executor: Executor = db,
): Promise<void> {
    const requires = await settingsService.patientRequirements(executor);
    if (requires.requireAge && isBlank(details.birthDate)) throw ageRequired();
    if (requires.requireGender && isBlank(details.gender)) throw genderRequired();
}

/**
 * Refuses an edit that clears a field the clinic requires. A field the patch
 * leaves out is not judged: turning a rule on must not lock every record
 * already on file without it, so those are asked for by the editor instead.
 */
function assertNotCleared(
    patch: { birthDate?: string | null; gender?: string | null },
    requires: PatientRequirements,
): void {
    if (requires.requireAge && patch.birthDate !== undefined && isBlank(patch.birthDate)) throw ageRequired();
    if (requires.requireGender && patch.gender !== undefined && isBlank(patch.gender)) throw genderRequired();
}

/**
 * Hands out `settings.patient_ref_next` and moves it on. `RETURNING` sees the
 * incremented value, so the number actually handed out is the one before it —
 * which is the whole difference between this and the `patient_ref_last` it
 * replaced, where a clinic that typed 910 watched the next patient get 911.
 */
async function nextPatientRef(executor: Executor): Promise<number> {
    const take = () =>
        executor
            .update(settings)
            .set({ patientRefNext: sql`${settings.patientRefNext} + 1` })
            .where(eq(settings.id, 1))
            .returning({ next: settings.patientRefNext });

    let [counter] = await take();
    if (!counter) {
        // The row is seeded on first read, and nothing has read it yet.
        await settingsService.ensureSeeded();
        [counter] = await take();
    }

    if (!counter) throw AppError.internal('settings row could not be seeded');
    return counter.next - 1;
}

/**
 * Refuses an old number the new-patient sequence has still to hand out.
 *
 * The premise of the cutoff is that every old number is below it — a clinic
 * sets the next number above the last one its old system used. A number typed
 * at or above it (9100 for 910, say) is not a record that can be kept: the
 * sequence reaches it eventually and the unique constraint refuses the *new*
 * patient, months later, for something typed today. Refusing it now names the
 * field instead.
 *
 * A ref that is not a plain number cannot collide with the sequence and is
 * taken as it stands. `FOR UPDATE` on the settings row is what makes this and
 * the counter agree: a registration numbering itself and a settings write
 * moving the counter both queue behind it.
 */
async function assertOldRefUnreserved(tx: Executor, oldRef: string): Promise<void> {
    if (!/^\d+$/.test(oldRef)) return;

    const read = () =>
        tx.select({ next: settings.patientRefNext }).from(settings).where(eq(settings.id, 1)).for('update');

    let [row] = await read();
    if (!row) {
        // Seeded on first read, and nothing has read it yet — the same shape
        // `nextPatientRef` uses, and the reason the seed is not attempted up
        // front: it writes on another connection, and this one holds locks.
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

/** Grouped by visit, in the order the lines were priced. */
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

/** Grouped by appointment, in the order the booking planned them. */
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

/** The id breaks ties on `created_at`, so a page boundary never repeats or drops a row. */
const newestFirst = [desc(patients.createdAt), desc(patients.id)];
const byName = [asc(patients.name), asc(patients.id)];

export const patientService = {
    /**
     * Name, phone, or the number on the file. The ref is in here because an old
     * patient's ref *is* the number written on their paper file — the desk
     * reads `710` off the front of it and types it — and `legacy_ref` is here
     * beside it for the records that came across before that was true, whose
     * `ref` is a number this app allocated and nobody has ever seen. Both are
     * matched as a substring, like the name: a half-typed number should narrow
     * the list rather than find nothing until the last digit.
     *
     * The same is true of the phone, and is why the term goes through
     * `phoneSearchTerm` rather than `normalizePhone`: a number still being typed
     * does not normalize, and matched as typed it would find nothing at all.
     * Several patients can share a number, so every one of them comes back.
     */
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

    /**
     * Everyone already on file under this number, oldest first.
     *
     * `phone` is indexed but not unique, and deliberately: two siblings share a
     * mother's number, and refusing the second one at the desk would be
     * refusing a patient. So this answers with a list and lets the caller
     * decide — data entry warns and carries on, because over a long migration
     * session the same patient does get typed twice.
     *
     * A term that will not normalize is not a duplicate, it is a number still
     * being typed, so it answers `[]` rather than throwing `INVALID_PHONE`.
     * Matching is on the normalized form, so `0101…` finds a stored `+20101…`.
     */
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

    /**
     * Who was registered last, newest first — what the Patients tab opens on
     * before anything is typed — or the whole register A–Z. `search` deliberately answers `[]` for an empty
     * term, so browsing needed a procedure of its own rather than a term that
     * matches everybody.
     */
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

    /**
     * The record in one payload (§13). Driven from `appointments`, not `visits`:
     * a no-show and a cancellation never produce a visit, and a record read to
     * answer "has this patient turned up before" has to show them. The visit is
     * left-joined, so every money column is zero until there is one.
     *
     * Procedures come from the visit when the patient reached the chair — those
     * carry the price actually billed — and from the booking when they did not,
     * which is the only record of what was going to be done. Both are fetched
     * once for the whole history rather than per row.
     */
    /** `viewer` is the caller's role when a router asks; omitted, everything is returned. */
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
                // Past: checked out, or brought over from the old system.
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

    /**
     * Registering someone, new or old — one screen, one procedure. `old` is what
     * the **Old patient** switch reveals, and its absence is the whole of what
     * makes this a new registration.
     *
     * An old patient is written in one transaction with everything they brought
     * with them: their number, what they owed, and whatever the paper file
     * records they had done. Half of that landing is worse than none of it — a
     * record on file owing nothing they actually owe is a wrong figure read out
     * at the desk months later — so any failure takes the patient down with it
     * and the row is typed again.
     *
     * Everything that can be refused is refused before the transaction opens:
     * the questionnaire, the catalogue lines, and whether the clinic has said
     * where an old patient's history is dated.
     */
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
            // The old number is both the ref the desk reads and the mark that
            // says this record came across, so it is written to both columns.
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

    /**
     * Correct the number a record is already known by.
     *
     * A ref goes at the top of a paper file and is read back off it for years,
     * so a wrong one is not something to live with. Any role may correct it —
     * the secretary is the one typing in the old paper cards — and two things
     * stand between a typo and the column:
     *
     * **What.** Both patient ref shapes stay valid, the plain number and the
     * four-character code a patient from before numbering carries, because that
     * code is still the number on their file. A number at or above
     * `patient_ref_next` is refused for the reason `assertOldRefUnreserved`
     * gives, which is the same reason and the same code as registering one.
     * Uniqueness is Postgres's answer, not a read-then-write: two phones
     * correcting onto the same number would both see it free.
     *
     * **A record of it.** Previous value, new value, role, and when — written in
     * the same transaction as the change, so a ref never moves without one.
     *
     * Re-typing the ref a patient already has is not a change and is not
     * audited. It is what a screen submitting an untouched field does, and
     * filling the trail with rows where nothing moved would bury the edits that
     * did.
     */
    async updateRef(
        { id, ref, editedBy: claimed }: UpdatePatientRefInput,
        caller?: Role | null,
    ): Promise<Patient> {
        // A provisioned phone is the role on its credential, whatever it
        // claims; only a phone with none is still taken at its word.
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

    /**
     * Every correction made to this patient's ref, newest first.
     *
     * The patient is not required to still exist. `ref_edits` is kept when a
     * record is deleted on purpose, and a ref moved onto the wrong patient who
     * was then deleted is the sequence most worth being able to read back — so
     * refusing the read for a record that is gone would withhold exactly the
     * history the table is retained for. An id nobody holds answers `[]`.
     */
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

    /**
     * Remove a record that should never have existed — a duplicate, a test
     * entry — and everything under it: bookings, visits, their lines, their
     * reminders. Refused if any visit has a payment on it, for the reason
     * `visitService.delete` gives; a record with money on it is a ledger, and
     * the way to be rid of it is to delete the payments first.
     */
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
