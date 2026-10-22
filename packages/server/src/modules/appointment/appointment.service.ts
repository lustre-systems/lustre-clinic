/**
 * SPEC §7. Double-booking is prevented by Postgres (§5); this service's job is
 * to turn SQLSTATE 23P01 into `SLOT_OVERLAP` so the client can say something
 * useful, and to keep the reminder row in step with the appointment.
 *
 * Missed appointments are never transitioned on a timer — they are listed for
 * someone to resolve (§7).
 *
 * `insertWithRef` retries only when the generated `ref` collided; an overlap is
 * a real answer there and is not retried. Every path that writes a span takes
 * `lockDay` first, so the planners queue rather than deadlock, and the walk-in
 * alone retries the whole transaction on the residue (`retryOnStaleDay`) —
 * being refused for want of room is the one answer a walk-in may not get.
 * The walk-in path imports the visit module
 * lazily to avoid an import cycle (visit reads appointments). `awaitPayment`
 * repeats the status in the UPDATE's predicate, so the write itself decides: a
 * checkout committing `done` in between would otherwise leave a settled visit
 * stuck in `awaiting_payment` with no way back.
 *
 * A booking carries the procedures the secretary expects (§7). They are
 * validated against §5 before the transaction opens — reads against reference
 * data, and the checks are about the request, not the booking — and written by
 * `replaceProcedures`, whose `sortOrder` preserves the entered order, which is
 * the order check-in seeds visit lines in, each at its `quotedPrice` when the
 * desk quoted one. `procedures` must be destructured
 * out of `update`'s patch: it is a separate table and would corrupt `set()`.
 * Omitting it leaves the list alone, an empty array clears it (§13). Reads
 * batch the catalogue join once per page rather than once per row.
 */
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

/** §7 — a planned procedure, with the catalogue name resolved for the client. */
interface AppointmentLine {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
    tooth: Tooth | null;
    note: string | null;
    /** Null unless the desk quoted a price; check-in then bills the catalogue's. */
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

/**
 * Exported for the migration module, which writes synthetic opening-balance
 * appointments and needs the same `ref` retry — a whole session's worth of them
 * land on one date, which is the only scope a `ref` is unique within.
 */
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

/** A booked appointment the walk-in pushed, and where it went. */
export interface Moved {
    id: string;
    from: Date;
    to: Date;
}

/** Where the walk-in ended up, and who moved for it. */
export interface WalkInRoom {
    startsAt: Date;
    moved: Moved[];
}

/** Arbitrary, and only has to be ours: advisory locks share one global space. */
const DAY_LOCK_NAMESPACE = 7301;

/**
 * Every path that writes a span takes this before it reads the day, so the
 * planners queue instead of racing. Without it two walk-ins read the same
 * layout, plan the same slot, and then sit on each other: checking an exclusion
 * constraint waits on the conflicting row's transaction, so the collision is
 * not a fast 23P01 but a lock wait that costs a full `deadlock_timeout` — one
 * second by default — before Postgres even looks for a cycle, and the cascade's
 * updates make a real cycle likely. Serialising the planners is far cheaper
 * than detecting the pile-up afterwards.
 *
 * Transaction-scoped: released on commit or rollback, so there is nothing to
 * unlock by hand and a failed booking cannot strand the day.
 *
 * Keyed on the UTC day of the span's start, which every writer derives the same
 * way. That is a bucket, not the clinic's day — it does not need to agree with
 * `dayRange`, only to be a value any two conflicting writes both compute. The
 * one gap is a span straddling UTC midnight, whose neighbours sit in different
 * buckets; the constraint still refuses those, and `retryOnStaleDay` still
 * picks them up, so the lock is what makes contention cheap rather than what
 * makes it correct.
 */
function lockDay(tx: Executor, spanStart: Date): Promise<unknown> {
    const bucket = Math.floor(spanStart.getTime() / 86_400_000);
    return tx.execute(sql`SELECT pg_advisory_xact_lock(${DAY_LOCK_NAMESPACE}, ${bucket})`);
}

const WALK_IN_ATTEMPTS = 5;

/**
 * `makeRoomForWalkIn` reads the day and the insert writes it, and between those
 * two the layout it read can stop being true: READ COMMITTED shows each
 * statement the rows committed when *it* began, so two walk-ins taken at the
 * same moment — or a walk-in and a phone booking — both plan against the same
 * day and the loser's insert lands on a slot that was free when it looked. The
 * constraint catches it, which is the point of having it, but the failure here
 * does not mean "that slot is taken", it means "the answer was computed from a
 * stale day".
 *
 * It arrives two ways. If the loser simply waits for the winner, it is 23P01,
 * already mapped to SLOT_OVERLAP. If each ends up waiting on the other — which
 * the cascade's updates make easy, since checking an exclusion constraint takes
 * a lock on the conflicting row's transaction — Postgres breaks the cycle with
 * 40P01 and neither is at fault. Both are retried, and so is 40001, which the
 * same race raises under a stricter isolation level.
 *
 * The loser re-reads and queues behind the winner instead of refusing a patient
 * who is standing at the desk. The whole transaction is retried, because a
 * failed statement aborts it and nothing inside it can be reused. That is safe
 * precisely because everything it did is rolled back: the patient, the
 * appointment, the reminder, the visit and the moves all go, and the broadcasts
 * have not happened yet.
 *
 * Bounded, so a genuine impossibility cannot spin. Exhausting the attempts is
 * reported as whatever the last failure was — with one practitioner and a desk
 * or two, five rounds is far past what contention can plausibly produce.
 *
 * Only the walk-in path retries. For `create`, SLOT_OVERLAP is the honest
 * answer to "book me at four o'clock" and must reach the secretary unchanged.
 */
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

            // A deadlock's loser is chosen by the server, so two callers can be
            // sent back at the same instant to collide again. A short random
            // wait separates them; it grows so a genuine pile-up still drains.
            const backoff = Math.random() * 10 * 2 ** attempt;
            await Bun.sleep(backoff);
        }
    }
}

/**
 * A walk-in is someone standing at the desk, so it is never refused for want of
 * room — it is taken and the booked day moves out of its way (§7). Only the
 * rows it actually runs into move, and only as far as they must: the walk-in's
 * end becomes a cursor, each later slot-holding row that starts before the
 * cursor is pushed to it, and the first row that already clears the cursor
 * stops the ripple. A clinic's natural gaps therefore absorb the walk-in
 * instead of the whole afternoon sliding.
 *
 * It is taken *now* only if the chair is free now. There is one practitioner
 * (§5), so a slot still running when the patient arrives — the running-late
 * case — cannot be pushed aside without interrupting a procedure already in
 * progress. That row stays; the walk-in starts when it ends, and the cascade
 * runs from there. Nobody is refused, and nobody is pulled out of the chair.
 * At most one row can be running: the exclusion constraint sees to that.
 *
 * The rows are written *last one first*. Every move is forwards, so ascending
 * order would push one appointment onto the next before that next one has
 * moved, and `appointments_no_overlap` — which is not deferrable — would refuse
 * the write halfway through a legal rearrangement.
 *
 * Cancelled and no-show rows hold no slot and are left where they are.
 *
 * The cascade has no day boundary, only the chain of rows it runs into. It
 * reads just the rows starting before the cursor, moves them, and reads again
 * from where the last read ended; the first read that comes back empty is the
 * gap that ends it. A queue that runs past midnight therefore still sees the
 * walk-ins it pushed there earlier, and a booking just after midnight that the
 * walk-in runs into moves rather than refusing it. Tomorrow behind a gap is
 * never read, so it is never touched. A row across the UTC day falls in the
 * next `lockDay` bucket, so a push can still race a booking there; that 23P01
 * is mapped like the insert's, and `retryOnStaleDay` re-plans.
 */
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
                // The same span the constraint indexes, so this reads the gist
                // index and agrees with it by construction. Half-open, so a row
                // ending exactly as the patient arrives is already out of the chair.
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
        // Rows cannot overlap each other, so everything starting before the
        // cursor is in the walk-in's way, and nothing else is yet.
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

/** Appointments with the patient fields every list shows. The filter and order are the caller's. */
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
                    // Nobody came to these. They exist so a migrated balance
                    // has a visit to hang on, and a schedule showing four
                    // hundred of them on the cutoff date is a schedule the
                    // secretary stops reading. Imported work is the same: it
                    // happened at the old clinic, and a row dated the day an
                    // undated file was typed in is not a day's schedule.
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
            // A booking races the walk-in taken at the same moment. It does not
            // retry — SLOT_OVERLAP is the honest answer to "book me at four" —
            // but it must not turn that answer into a deadlock either.
            await lockDay(tx, startsAt);

            // Under the settings lock and inside the transaction, so a lead
            // time changed mid-booking cannot leave this one reminder behind
            // the setting: the reschedule in `settings.update` either has not
            // started or has already finished. Taken here, before the patient
            // is registered, because that bumps the same row.
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

                // Before the insert, not after: the walk-in cannot be written into
                // a slot something else still holds. This also decides when it
                // starts — now, or when the chair frees.
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
        // Everyone who moved changed on someone else's screen too.
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

        // Only a booking still to come can move. Past check-in the span is the
        // chair's record of the visit, and a reschedule page left open while
        // the patient arrived must not drag it, or its reminder, elsewhere.
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
            // Rescheduling and re-timing both move a span, so this contends
            // with the other two writers on the day it is moving into.
            await lockDay(tx, startsAt ?? current.startsAt);

            // Before the appointment is touched, so every writer takes the two
            // locks in the same order: the day, then the settings row.
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
                    // The status is repeated here for the check-in that lands
                    // between the read above and this write, as in `awaitPayment`.
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

    /**
     * Idempotent: the reminder row and the detail sheet can both offer it, and
     * a second tap, or a tap on a screen that has not yet seen the requirement
     * switched off, finds nothing pending and gets the row back unchanged.
     */
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

        // The transition and the seating are one write: going to the desk is
        // what empties the chair, and the patient who has been waiting starts
        // their visit at that instant rather than at the time they arrived.
        // Split across two statements, a failure between them would leave the
        // chair empty with a queue in front of it and nobody's bar running.
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
        // The doctor finishing is this transition and nothing else — `checkOut`
        // is the desk's own write. The conditional UPDATE above is what makes it
        // one event per visit: a retry finds the appointment already moved on.
        broadcast(WS_EVENT.VISIT_COMPLETED, { id });
        return updated;
    },

    async requireExists(id: string): Promise<AppointmentRow> {
        return requireRow(id);
    },
};
