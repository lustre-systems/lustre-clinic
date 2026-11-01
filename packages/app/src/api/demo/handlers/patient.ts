/**
 * `server/src/modules/patient/patient.service.ts`. Phone is normalized on
 * write; age is derived at read time and never stored.
 *
 * `byId` is driven from appointments rather than visits, because a cancellation
 * and a no-show never produce a visit and a record read to answer "has this
 * patient turned up before" has to show them. Procedures come from the visit
 * when the patient reached the chair — those carry the price actually billed —
 * and from the booking when they did not.
 */
import { ERROR_CODE, PATIENT_REF_PATTERN, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, type PatientRow, save } from '../db';
import { broadcast } from '../events';
import {
    ageFromBirthDate,
    assertNotCleared,
    assertRegistrable,
    assignDefined,
    buildPatientRef,
    DemoError,
    normalizePhone,
    phoneSearchTerm,
    uuidv7,
} from '../rules';
import type { Dated } from '../wire';
import { type Answers, customQuestionHandlers } from './customQuestion';
import { planOldPatientHistory, writeOldPatientHistory } from './migration';

type Patient = Dated<RouterOutput['patient']['search'][number]>;
type PatientDetail = Dated<RouterOutput['patient']['byId']>;
type HistoryEntry = PatientDetail['history'][number];
type HistoryProcedure = HistoryEntry['procedures'][number];
type RefEdit = Dated<RouterOutput['patient']['refHistory'][number]>;

export function toPatient(row: PatientRow): Patient {
    return { ...row, age: ageFromBirthDate(row.birthDate) };
}

export function requirePatient(id: string): PatientRow {
    const row = getDb().patients.find((patient) => patient.id === id);
    if (!row) throw DemoError.notFound('patient');
    return row;
}

function answersOf(row: PatientRow): Answers {
    return row.custom ?? {};
}

/** `createPatientInput` less the questionnaire — what a booking knows. */
type MinimalPatientInput = Omit<RouterInput['patient']['create'], 'custom'>;

export function createMinimalPatient(input: MinimalPatientInput): PatientRow {
    assertRegistrable(input, getDb().settings);

    const row: PatientRow = {
        id: uuidv7(),
        ref: buildPatientRef(),
        name: input.name,
        phone: normalizePhone(input.phone),
        email: input.email ?? null,
        birthDate: input.birthDate ?? null,
        gender: input.gender ?? null,
        custom: {},
        notes: input.notes ?? null,
        legacyRef: input.legacyRef ?? null,
        createdAt: new Date(),
    };

    getDb().patients.push(row);
    save();
    return row;
}

/** The server's order: newest first, the id breaking ties so a page boundary is stable. */
function newestFirst(a: PatientRow, b: PatientRow): number {
    return b.createdAt.getTime() - a.createdAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
}

function byName(a: PatientRow, b: PatientRow): number {
    return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function pageOf(input: { limit?: number; offset?: number }): [number, number] {
    const offset = input.offset ?? 0;
    return [offset, offset + (input.limit ?? 25)];
}

export const patientHandlers = {
    search(input: RouterInput['patient']['search']): Patient[] {
        const term = input.q.trim();
        if (!term) return [];

        // `0101…` has to find a stored `+20101…`, and so does a `010123` still
        // being typed — which is why this is not `normalizePhone`.
        const phoneTerm = phoneSearchTerm(term);

        const needle = term.toLowerCase();

        return [...getDb().patients]
            .filter(
                (row) =>
                    row.name.toLowerCase().includes(needle) ||
                    (phoneTerm !== null && row.phone.includes(phoneTerm)) ||
                    row.ref.toLowerCase().includes(needle) ||
                    (row.legacyRef ?? '').toLowerCase().includes(needle),
            )
            .sort(newestFirst)
            .slice(...pageOf(input))
            .map(toPatient);
    },

    /**
     * Everyone on file under this number, oldest first. `phone` is not unique
     * on purpose — two siblings share a mother's number — so this answers with
     * a list and lets the desk decide.
     */
    byPhone(input: RouterInput['patient']['byPhone']): Patient[] {
        let phone: string;
        try {
            phone = normalizePhone(input.phone);
        } catch {
            return [];
        }

        return [...getDb().patients]
            .filter((row) => row.phone === phone)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map(toPatient);
    },

    recent(input: RouterInput['patient']['recent']): Dated<RouterOutput['patient']['recent']> {
        const rows = [...getDb().patients].sort(input.order === 'name' ? byName : newestFirst);

        return {
            patients: rows.slice(...pageOf(input)).map(toPatient),
            total: rows.length,
        };
    },

    byId(input: RouterInput['patient']['byId']): PatientDetail {
        const db = getDb();
        const patient = requirePatient(input.id);

        const history: HistoryEntry[] = [...db.appointments]
            .filter((appointment) => appointment.patientId === input.id)
            .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
            .map((appointment) => {
                const visit = db.visits.find((row) => row.appointmentId === appointment.id) ?? null;

                const paidTotal = visit
                    ? db.payments
                          .filter((payment) => payment.visitId === visit.id)
                          .reduce((sum, payment) => sum + payment.amount, 0)
                    : 0;
                const chargedTotal = visit?.chargedTotal ?? 0;

                const procedures: HistoryProcedure[] = visit
                    ? db.visitProcedures
                          .filter((line) => line.visitId === visit.id)
                          .map((line) => ({
                              name: nameOf(line.procedureId),
                              quantity: line.quantity,
                              tooth: line.tooth,
                          }))
                    : db.appointmentProcedures
                          .filter((line) => line.appointmentId === appointment.id)
                          .sort((a, b) => a.sortOrder - b.sortOrder)
                          .map((line) => ({
                              name: nameOf(line.procedureId),
                              quantity: line.quantity,
                              tooth: line.tooth,
                          }));

                return {
                    appointmentId: appointment.id,
                    visitId: visit?.id ?? null,
                    ref: appointment.ref,
                    startsAt: appointment.startsAt,
                    status: appointment.status,
                    isOpeningBalance: appointment.isOpeningBalance,
                    isImported: appointment.isImported,
                    dateUnknown: appointment.dateUnknown,
                    checkedInAt: visit?.checkedInAt ?? null,
                    completedAt: visit?.completedAt ?? null,
                    computedTotal: visit?.computedTotal ?? 0,
                    chargedTotal,
                    paidTotal,
                    balance: chargedTotal - paidTotal,
                    procedures,
                };
            });

        return {
            patient: toPatient(patient),
            history,
            questionnaireGaps: customQuestionHandlers.auditAnswers(answersOf(patient)),
        };
    },

    /**
     * Registering someone, new or old. `old` is what the **Old patient** switch
     * reveals; its absence is the whole of what makes this a new registration.
     *
     * An old patient keeps the number on their paper file as their `ref` — the
     * desk was given one number for them and must not be handed a second — and
     * `legacyRef` carries the same string, which is what marks the record as
     * having come across. It refuses what the server refuses: the number twice,
     * and a plain number the new-patient sequence has still to reach.
     */
    create(input: RouterInput['patient']['create']): Patient {
        // Before the questionnaire, the order the server refuses them in.
        assertRegistrable(input, getDb().settings);
        const custom = customQuestionHandlers.validateIntake(input.custom ?? {});

        if (input.old === undefined) {
            const row = createMinimalPatient(input);
            row.custom = custom;
            save();
            return toPatient(row);
        }

        const old = input.old;
        if (getDb().patients.some((patient) => patient.ref === old.ref)) {
            throw new DemoError(ERROR_CODE.PATIENT_REF_TAKEN, 'another patient already has that number', 409);
        }

        // A plain number the sequence has still to hand out — the server's
        // rule, so the demo refuses what the clinic would refuse.
        const next = getDb().settings.patientRefNext;
        if (/^\d+$/.test(old.ref) && Number(old.ref) >= next) {
            throw new DemoError(
                ERROR_CODE.PATIENT_REF_RESERVED,
                `${old.ref} is at or above the next patient number (${next}) and is not yet a patient's`,
                422,
            );
        }

        const plan = planOldPatientHistory(old);

        const row = createMinimalPatient({ ...input, legacyRef: old.ref });
        row.ref = old.ref;
        row.custom = custom;
        if (plan) writeOldPatientHistory(row.id, plan);

        save();
        return toPatient(row);
    },

    update(input: RouterInput['patient']['update']): Patient {
        const { id, ...patch } = input;
        const current = requirePatient(id);
        assertNotCleared(patch, getDb().settings);

        const custom = patch.custom
            ? customQuestionHandlers.validatePatch(answersOf(current), patch.custom)
            : undefined;

        assignDefined(current, patch, {
            ...(patch.phone === undefined ? {} : { phone: normalizePhone(patch.phone) }),
            ...(custom ? { custom } : {}),
        });

        save();
        return toPatient(current);
    },

    /**
     * `patientService.updateRef`. Same three gates in the same order: the shape
     * a patient ref takes — both of them, the plain number and the code a
     * patient from before numbering carries — then a number the sequence has
     * still to hand out, then a ref another patient already has. Re-typing the
     * ref a record already has changes nothing and is not audited.
     */
    updateRef(input: RouterInput['patient']['updateRef']): Patient {
        const next = input.ref.trim().toUpperCase();
        if (!PATIENT_REF_PATTERN.test(next)) {
            throw new DemoError(
                ERROR_CODE.PATIENT_REF_INVALID,
                'a patient ref is a plain number, or the four-character code a patient from before numbering carries',
                422,
            );
        }

        const db = getDb();
        const current = requirePatient(input.id);
        if (current.ref === next) return toPatient(current);

        const counter = db.settings.patientRefNext;
        if (/^\d+$/.test(next) && Number(next) >= counter) {
            throw new DemoError(
                ERROR_CODE.PATIENT_REF_RESERVED,
                `${next} is at or above the next patient number (${counter}) and is not yet a patient's`,
                422,
            );
        }

        if (db.patients.some((patient) => patient.ref === next)) {
            throw new DemoError(ERROR_CODE.PATIENT_REF_TAKEN, 'another patient already has that number', 409);
        }

        db.refEdits.push({
            id: uuidv7(),
            entity: 'patient',
            entityId: current.id,
            previousRef: current.ref,
            newRef: next,
            editedBy: input.editedBy,
            editedAt: new Date(),
        });
        current.ref = next;

        save();
        return toPatient(current);
    },

    /** Every correction made to this patient's ref, newest first. */
    refHistory(input: RouterInput['patient']['refHistory']): RefEdit[] {
        return [...getDb().refEdits]
            .filter((row) => row.entity === 'patient' && row.entityId === input.id)
            .sort((a, b) => b.editedAt.getTime() - a.editedAt.getTime())
            .map(({ previousRef, newRef, editedBy, editedAt }) => ({
                previousRef,
                newRef,
                editedBy,
                editedAt,
            }));
    },

    delete(input: RouterInput['patient']['delete']): void {
        const db = getDb();
        requirePatient(input.id);

        const owned = new Set(
            db.appointments.filter((row) => row.patientId === input.id).map((row) => row.id),
        );
        const visitIds = new Set(
            db.visits.filter((row) => owned.has(row.appointmentId)).map((row) => row.id),
        );

        if (db.payments.some((row) => visitIds.has(row.visitId))) {
            throw new DemoError(ERROR_CODE.HAS_PAYMENTS, 'this patient has payments recorded', 409);
        }

        db.visitProcedures = db.visitProcedures.filter((row) => !visitIds.has(row.visitId));
        db.visits = db.visits.filter((row) => !visitIds.has(row.id));
        db.reminders = db.reminders.filter((row) => !owned.has(row.appointmentId));
        db.appointmentProcedures = db.appointmentProcedures.filter((row) => !owned.has(row.appointmentId));
        db.appointments = db.appointments.filter((row) => !owned.has(row.id));
        db.patients = db.patients.filter((row) => row.id !== input.id);

        save();
        broadcast(WS_EVENT.VISIT_UPDATED);
    },
};

function nameOf(procedureId: string): string {
    return getDb().procedureTypes.find((row) => row.id === procedureId)?.name ?? 'Procedure';
}
