import {
    canTransition,
    ERROR_CODE,
    type LabStatus,
    SLOT_HOLDING_STATUSES,
    type Tooth,
    WS_EVENT,
} from '@lustre/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { appointmentProcedures, appointments, patients, procedureTypes } from '../../db/schema.ts';
import { AppError, PG_ERROR, pgErrorCode } from '../../errors/AppError.ts';
import { buildRef } from '../../util/ref.ts';
import { clinicDayOf, dayRange } from '../../util/time.ts';
import { broadcast } from '../../ws/index.ts';
import { patientService } from '../patient/patient.service.ts';
import {
    type RequestedLine,
    type ResolvedLine,
    resolveProcedureLines,
} from '../procedure/procedure.rules.ts';
import { reminderService } from '../reminder/reminder.service.ts';
import { settingsService } from '../settings/settings.service.ts';
import { takeNext } from '../visit/visit.next.ts';
import { seatNextInChair } from '../visit/visit.service.ts';
import type {
    ByDateInput,
    CreateAppointmentInput,
    MissedInput,
    PatientRefInput,
    UpdateAppointmentInput,
    WalkInInput,
} from './appointment.schema.ts';

export type AppointmentRow = typeof appointments.$inferSelect;

interface AppointmentLine {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
    tooth: Tooth | null;
    note: string | null;
    quotedPrice: number | null;
}

interface AppointmentWithPatient extends AppointmentRow {
    patient: { id: string; ref: string; name: string; phone: string };
    procedures: AppointmentLine[];
}

const REF_ATTEMPTS = 5;

function labStatusFor(needsLab: boolean | undefined): LabStatus | null {
    return needsLab ? 'pending' : null;
}

function mapWriteError(err: unknown): never {
    if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION) {
        throw new AppError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment', 409, {
            cause: err,
        });
    }
    throw err;
}

async function resolveDuration(requested: number | undefined): Promise<number> {
    const { durationOptions, defaultDuration } = await settingsService.get();
    if (requested === undefined) return defaultDuration;

    if (!durationOptions.includes(requested)) {
        throw new AppError(ERROR_CODE.INVALID_DURATION, 'duration is not one of the configured options', 422);
    }
    return requested;
}

async function resolvePatient(executor: Executor, ref: PatientRefInput): Promise<string> {
    if (ref.kind === 'existing') {
        await patientService.requireExists(ref.patientId);
        return ref.patientId;
    }
    const { kind: _kind, ...details } = ref;
    const created = await patientService.createMinimal(details, executor);
    return created.id;
}

async function requireRow(id: string): Promise<AppointmentRow> {
    const [row] = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
    if (!row) throw AppError.notFound('appointment');
    return row;
}

async function loadProcedures(ids: string[]): Promise<Map<string, AppointmentLine[]>> {
    const byAppointment = new Map<string, AppointmentLine[]>();
    if (ids.length === 0) return byAppointment;

    const rows = await db
        .select({
            id: appointmentProcedures.id,
            appointmentId: appointmentProcedures.appointmentId,
            procedureId: appointmentProcedures.procedureId,
            name: procedureTypes.name,
            quantity: appointmentProcedures.quantity,
            tooth: appointmentProcedures.tooth,
            note: appointmentProcedures.note,
            quotedPrice: appointmentProcedures.quotedPrice,
        })
        .from(appointmentProcedures)
        .innerJoin(procedureTypes, eq(appointmentProcedures.procedureId, procedureTypes.id))
        .where(inArray(appointmentProcedures.appointmentId, ids))
        .orderBy(asc(appointmentProcedures.sortOrder));

    for (const { appointmentId, ...line } of rows) {
        const lines = byAppointment.get(appointmentId) ?? [];
        lines.push(line);
        byAppointment.set(appointmentId, lines);
    }
    return byAppointment;
}

async function withProcedures(
    rows: (AppointmentRow & { patient: AppointmentWithPatient['patient'] })[],
): Promise<AppointmentWithPatient[]> {
    const byAppointment = await loadProcedures(rows.map((r) => r.id));
    return rows.map((row) => ({ ...row, procedures: byAppointment.get(row.id) ?? [] }));
}

type PlannedLine = ResolvedLine & { quotedPrice: number | null };

async function resolvePlan(
    lines: (RequestedLine & { quotedPrice?: number | null })[],
): Promise<PlannedLine[]> {
    const resolved = await resolveProcedureLines(lines);
    return resolved.map((line, i) => ({ ...line, quotedPrice: lines[i]?.quotedPrice ?? null }));
}

async function replaceProcedures(
    executor: Executor,
    appointmentId: string,
    resolved: PlannedLine[],
): Promise<void> {
    await executor
        .delete(appointmentProcedures)
        .where(eq(appointmentProcedures.appointmentId, appointmentId));

    if (resolved.length === 0) return;

    await executor.insert(appointmentProcedures).values(
        resolved.map((line, i) => ({
            id: Bun.randomUUIDv7(),
            appointmentId,
            procedureId: line.procedure.id,
            quantity: line.quantity,
            tooth: line.tooth,
            note: line.note,
            quotedPrice: line.quotedPrice,
            sortOrder: i,
        })),
    );
}

export async function insertWithRef(
    executor: Executor,
    values: Omit<typeof appointments.$inferInsert, 'id' | 'ref'>,
    offsetMinutes: number,
): Promise<AppointmentRow> {
    for (let attempt = 0; attempt < REF_ATTEMPTS; attempt += 1) {
        try {
            const [row] = await executor
                .insert(appointments)
                .values({ ...values, id: Bun.randomUUIDv7(), ref: buildRef(values.startsAt, offsetMinutes) })
                .returning();

            if (!row) throw AppError.internal('appointment insert returned nothing');
            return row;
        } catch (err) {
            if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) continue;
            mapWriteError(err);
        }
    }

    throw new AppError(ERROR_CODE.REF_GENERATION_FAILED, 'could not allocate a unique ref', 500);
}

export interface Moved {
    id: string;
    from: Date;
    to: Date;
}

export interface WalkInRoom {
    startsAt: Date;
    moved: Moved[];
}

const DAY_LOCK_NAMESPACE = 7301;

function lockDay(tx: Executor, spanStart: Date): Promise<unknown> {
    const bucket = Math.floor(spanStart.getTime() / 86_400_000);
    return tx.execute(sql`SELECT pg_advisory_xact_lock(${DAY_LOCK_NAMESPACE}, ${bucket})`);
}

const WALK_IN_ATTEMPTS = 5;

function isStaleDay(err: unknown): boolean {
    if (err instanceof AppError && err.code === ERROR_CODE.SLOT_OVERLAP) return true;

    const code = pgErrorCode(err);
    return code === PG_ERROR.DEADLOCK_DETECTED || code === PG_ERROR.SERIALIZATION_FAILURE;
}

async function retryOnStaleDay<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await run();
        } catch (err) {
            if (!isStaleDay(err) || attempt >= WALK_IN_ATTEMPTS) throw err;

            const backoff = Math.random() * 10 * 2 ** attempt;
            await Bun.sleep(backoff);
        }
    }
}

export async function makeRoomForWalkIn(
    tx: Executor,
    at: Date,
    durationMinutes: number,
): Promise<WalkInRoom> {
    const [running] = await tx
        .select({
            startsAt: appointments.startsAt,
            durationMinutes: appointments.durationMinutes,
        })
        .from(appointments)
        .where(
            and(
                sql`appointment_span(${appointments.startsAt}, ${appointments.durationMinutes}) @> ${at.toISOString()}::timestamptz`,
                inArray(appointments.status, [...SLOT_HOLDING_STATUSES]),
            ),
        )
        .limit(1);

    const startsAt = running ? new Date(running.startsAt.getTime() + running.durationMinutes * 60_000) : at;

    let readFrom = startsAt;
    let cursor = startsAt.getTime() + durationMinutes * 60_000;
    const moves: Moved[] = [];

    for (;;) {
        const inTheWay = await tx
            .select({
                id: appointments.id,
                startsAt: appointments.startsAt,
                durationMinutes: appointments.durationMinutes,
            })
            .from(appointments)
            .where(
                and(
                    gte(appointments.startsAt, readFrom),
                    lt(appointments.startsAt, new Date(cursor)),
                    inArray(appointments.status, [...SLOT_HOLDING_STATUSES]),
                ),
            )
            .orderBy(asc(appointments.startsAt));

        if (inTheWay.length === 0) break;

        readFrom = new Date(cursor);
        for (const row of inTheWay) {
            moves.push({ id: row.id, from: row.startsAt, to: new Date(cursor) });
            cursor += row.durationMinutes * 60_000;
        }
    }

    for (const move of [...moves].reverse()) {
        await tx
            .update(appointments)
            .set({ startsAt: move.to })
            .where(eq(appointments.id, move.id))
            .catch(mapWriteError);
    }

    return { startsAt, moved: moves };
}

function selectWithPatient() {
    return db
        .select({
            appointment: appointments,
            patient: { id: patients.id, ref: patients.ref, name: patients.name, phone: patients.phone },
        })
        .from(appointments)
        .innerJoin(patients, eq(appointments.patientId, patients.id));
}

export const appointmentService = {
    async byDate(input: ByDateInput): Promise<AppointmentWithPatient[]> {
        const { from, to } = dayRange(input.date, input.offsetMinutes);

        const rows = await selectWithPatient()
            .where(
                and(
                    gte(appointments.startsAt, from),
                    lt(appointments.startsAt, to),
                    eq(appointments.isOpeningBalance, false),
                    eq(appointments.isImported, false),
                    ...(input.branchId ? [eq(appointments.branchId, input.branchId)] : []),
                ),
            )
            .orderBy(asc(appointments.startsAt));

        return withProcedures(rows.map((r) => ({ ...r.appointment, patient: r.patient })));
    },

    async byId(id: string): Promise<AppointmentWithPatient> {
        const [row] = await selectWithPatient().where(eq(appointments.id, id)).limit(1);

        if (!row) throw AppError.notFound('appointment');
        const byAppointment = await loadProcedures([row.appointment.id]);
        return {
            ...row.appointment,
            patient: row.patient,
            procedures: byAppointment.get(row.appointment.id) ?? [],
        };
    },

    async missed(input: MissedInput = { limit: 100 }): Promise<AppointmentWithPatient[]> {
        const rows = await selectWithPatient()
            .where(
                and(
                    eq(appointments.status, 'booked'),
                    sql`${appointments.startsAt} + make_interval(mins => ${appointments.durationMinutes}) < now()`,
                    ...(input.branchId ? [eq(appointments.branchId, input.branchId)] : []),
                ),
            )
            .orderBy(desc(appointments.startsAt))
            .limit(input.limit);

        return withProcedures(rows.map((r) => ({ ...r.appointment, patient: r.patient })));
    },

    async create(input: CreateAppointmentInput): Promise<AppointmentRow> {
        const durationMinutes = await resolveDuration(input.durationMinutes);
        const startsAt = new Date(input.startsAt);
        const resolved = await resolvePlan(input.procedures ?? []);

        const row = await db.transaction(async (tx) => {
            await lockDay(tx, startsAt);

            const reminderLeadHours = await settingsService.leadHoursForWrite(tx);

            const patientId = await resolvePatient(tx, input.patient);

            const appointment = await insertWithRef(
                tx,
                {
                    patientId,
                    branchId: input.branchId,
                    startsAt,
                    durationMinutes,
                    note: input.note ?? null,
                    labStatus: labStatusFor(input.needsLab),
                },
                input.offsetMinutes,
            );

            await replaceProcedures(tx, appointment.id, resolved);
            await takeNext(tx, patientId, appointment.id);

            await reminderService.scheduleFor(tx, appointment, reminderLeadHours);
            return appointment;
        });

        broadcast(WS_EVENT.APPOINTMENT_CREATED, { id: row.id });
        return row;
    },

    async walkIn(
        input: WalkInInput,
    ): Promise<{ appointment: AppointmentRow; visitId: string; moved: Moved[] }> {
        const durationMinutes = await resolveDuration(input.durationMinutes);
        const arrivedAt = new Date();
        const resolved = await resolvePlan(input.procedures ?? []);

        const { visitService } = await import('../visit/visit.service.ts');

        const attempt = () =>
            db.transaction(async (tx) => {
                await lockDay(tx, arrivedAt);

                const reminderLeadHours = await settingsService.leadHoursForWrite(tx);

                const patientId = await resolvePatient(tx, input.patient);

                const { startsAt, moved } = await makeRoomForWalkIn(tx, arrivedAt, durationMinutes);

                const appointment = await insertWithRef(
                    tx,
                    {
                        patientId,
                        branchId: input.branchId,
                        startsAt,
                        durationMinutes,
                        note: input.note ?? null,
                        channel: 'walk_in',
                        labStatus: labStatusFor(input.needsLab),
                    },
                    input.offsetMinutes,
                );

                await replaceProcedures(tx, appointment.id, resolved);
                await takeNext(tx, patientId, appointment.id);

                await reminderService.scheduleFor(tx, appointment, reminderLeadHours);
                await reminderService.skipFor(tx, appointment.id);

                const visit = await visitService.checkIn(
                    { appointmentId: appointment.id, offsetMinutes: input.offsetMinutes },
                    tx,
                );

                const [current] = await tx
                    .select()
                    .from(appointments)
                    .where(eq(appointments.id, appointment.id))
                    .limit(1);

                return { appointment: current ?? appointment, visitId: visit.id, moved };
            });

        const result = await retryOnStaleDay(attempt);

        broadcast(WS_EVENT.APPOINTMENT_CREATED, { id: result.appointment.id });
        for (const move of result.moved) {
            broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id: move.id });
        }
        broadcast(WS_EVENT.APPOINTMENT_CHECKED_IN, { id: result.appointment.id });
        return result;
    },

    async update(input: UpdateAppointmentInput): Promise<AppointmentRow> {
        const { id, startsAt: _startsAt, procedures, needsLab, ...patch } = input;
        const current = await requireRow(id);

        if (patch.status && !canTransition(current.status, patch.status)) {
            throw new AppError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot go from ${current.status} to ${patch.status}`,
                422,
            );
        }

        const moves =
            input.startsAt !== undefined ||
            patch.durationMinutes !== undefined ||
            patch.branchId !== undefined;
        if (moves && current.status !== 'booked') {
            throw new AppError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot move an appointment that is ${current.status}`,
                409,
            );
        }

        const durationMinutes =
            patch.durationMinutes === undefined ? undefined : await resolveDuration(patch.durationMinutes);
        const startsAt = input.startsAt ? new Date(input.startsAt) : undefined;
        const resolved = procedures === undefined ? undefined : await resolvePlan(procedures);

        const row = await db.transaction(async (tx) => {
            await lockDay(tx, startsAt ?? current.startsAt);

            const leadHours = startsAt ? await settingsService.leadHoursForWrite(tx) : undefined;

            let updated: AppointmentRow | undefined;
            try {
                [updated] = await tx
                    .update(appointments)
                    .set({
                        ...patch,
                        ...(startsAt ? { startsAt } : {}),
                        ...(durationMinutes ? { durationMinutes } : {}),
                        ...(needsLab === undefined
                            ? {}
                            : {
                                  labStatus: needsLab
                                      ? sql<LabStatus>`coalesce(${appointments.labStatus}, 'pending')`
                                      : null,
                              }),
                        updatedAt: new Date(),
                    })
                    .where(
                        and(eq(appointments.id, id), ...(moves ? [eq(appointments.status, 'booked')] : [])),
                    )
                    .returning();
            } catch (err) {
                mapWriteError(err);
            }

            if (!updated && moves) {
                throw new AppError(
                    ERROR_CODE.INVALID_STATUS_TRANSITION,
                    'the appointment stopped being booked before the move landed',
                    409,
                );
            }
            if (!updated) throw AppError.notFound('appointment');

            if (resolved) await replaceProcedures(tx, id, resolved);

            if (startsAt && leadHours !== undefined) {
                await reminderService.reschedule(tx, id, startsAt, leadHours);
            }
            if (patch.status === 'no_show') await reminderService.skipFor(tx, id);

            return updated;
        });

        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id });
        return row;
    },

    async markLabReady(id: string): Promise<AppointmentRow> {
        const [updated] = await db
            .update(appointments)
            .set({ labStatus: 'ready', updatedAt: new Date() })
            .where(and(eq(appointments.id, id), eq(appointments.labStatus, 'pending')))
            .returning();

        if (!updated) return requireRow(id);

        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id });
        return updated;
    },

    async cancel(id: string): Promise<AppointmentRow> {
        const current = await requireRow(id);

        if (!canTransition(current.status, 'cancelled')) {
            throw new AppError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot cancel an appointment that is ${current.status}`,
                422,
            );
        }

        const row = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(appointments)
                .set({ status: 'cancelled', updatedAt: new Date() })
                .where(eq(appointments.id, id))
                .returning();

            if (!updated) throw AppError.notFound('appointment');

            await reminderService.skipFor(tx, id);
            return updated;
        });

        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id });
        return row;
    },

    async awaitPayment(id: string, offsetMinutes = 0): Promise<AppointmentRow> {
        const current = await requireRow(id);

        if (!canTransition(current.status, 'awaiting_payment')) {
            throw new AppError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot await payment on an appointment that is ${current.status}`,
                422,
            );
        }

        const updated = await db.transaction(async (tx) => {
            const now = new Date();

            const [row] = await tx
                .update(appointments)
                .set({ status: 'awaiting_payment', updatedAt: now })
                .where(and(eq(appointments.id, id), eq(appointments.status, 'checked_in')))
                .returning();

            if (row) await seatNextInChair(tx, row.branchId, clinicDayOf(row.startsAt, offsetMinutes), now);
            return row;
        });

        if (!updated) {
            throw new AppError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                'the appointment stopped being checked in before the change landed',
                409,
            );
        }

        broadcast(WS_EVENT.APPOINTMENT_UPDATED, { id });
        broadcast(WS_EVENT.VISIT_COMPLETED, { id });
        return updated;
    },

    async requireExists(id: string): Promise<AppointmentRow> {
        return requireRow(id);
    },
};
