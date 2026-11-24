import { canTransition, ERROR_CODE, SLOT_HOLDING_STATUSES, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { type AppointmentRow, getDb, save } from '../db';
import { broadcast } from '../events';
import { assignDefined, clinicDayOf, DemoError, dayRange, resolveProcedureLines, uuidv7 } from '../rules';
import type { Dated } from '../wire';
import { insertAppointment } from './appointmentRow';
import { createMinimalPatient, requirePatient } from './patient';
import { rescheduleReminder, scheduleReminderFor, skipReminderFor } from './reminder';
import { settingsHandlers } from './settings';
import { seatNextInChair, visitHandlers } from './visit';
import { takeNext } from './visitNext';

type AppointmentWithPatient = Dated<RouterOutput['appointment']['byDate'][number]>;
type AppointmentLine = AppointmentWithPatient['procedures'][number];

const HOLDS_SLOT: readonly string[] = SLOT_HOLDING_STATUSES;

function endOf(row: Pick<AppointmentRow, 'startsAt' | 'durationMinutes'>): number {
    return row.startsAt.getTime() + row.durationMinutes * 60_000;
}

function overlaps(candidate: { startsAt: Date; durationMinutes: number }, other: AppointmentRow): boolean {
    return candidate.startsAt.getTime() < endOf(other) && other.startsAt.getTime() < endOf(candidate);
}

function assertSlotFree(
    candidate: { startsAt: Date; durationMinutes: number; branchId: string },
    ignoreId?: string,
): void {
    const clash = getDb().appointments.some(
        (row) =>
            row.id !== ignoreId &&
            row.branchId === candidate.branchId &&
            HOLDS_SLOT.includes(row.status) &&
            overlaps(candidate, row),
    );

    if (clash) {
        throw new DemoError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment', 409);
    }
}

function requireRow(id: string): AppointmentRow {
    const row = getDb().appointments.find((appointment) => appointment.id === id);
    if (!row) throw DemoError.notFound('appointment');
    return row;
}

function resolveDuration(requested: number | undefined): number {
    const { durationOptions, defaultDuration } = settingsHandlers.get();
    if (requested === undefined) return defaultDuration;

    if (!durationOptions.includes(requested)) {
        throw new DemoError(
            ERROR_CODE.INVALID_DURATION,
            'duration is not one of the configured options',
            422,
        );
    }
    return requested;
}

function resolvePatient(ref: RouterInput['appointment']['create']['patient']): string {
    if (ref.kind === 'existing') {
        requirePatient(ref.patientId);
        return ref.patientId;
    }

    const { kind: _kind, ...details } = ref;
    return createMinimalPatient(details).id;
}

function replaceProcedures(
    appointmentId: string,
    requested: NonNullable<RouterInput['appointment']['create']['procedures']>,
): void {
    const db = getDb();
    const resolved = resolveProcedureLines(
        requested.map((line) => ({
            procedureId: line.procedureId,
            quantity: line.quantity ?? 1,
            tooth: line.tooth,
            note: line.note,
        })),
        db.procedureTypes,
        db.settings.clinicType === 'general',
    );

    db.appointmentProcedures = db.appointmentProcedures.filter(
        (line) => line.appointmentId !== appointmentId,
    );

    for (const [index, line] of resolved.entries()) {
        db.appointmentProcedures.push({
            id: uuidv7(),
            appointmentId,
            procedureId: line.procedure.id,
            quantity: line.quantity,
            tooth: line.tooth,
            note: line.note,
            quotedPrice: requested[index]?.quotedPrice ?? null,
            sortOrder: index,
        });
    }
}

function linesFor(appointmentId: string): AppointmentLine[] {
    const db = getDb();
    return db.appointmentProcedures
        .filter((line) => line.appointmentId === appointmentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => ({
            id: line.id,
            procedureId: line.procedureId,
            name: db.procedureTypes.find((row) => row.id === line.procedureId)?.name ?? 'Procedure',
            quantity: line.quantity,
            tooth: line.tooth,
            note: line.note,
            quotedPrice: line.quotedPrice,
        }));
}

function withPatient(row: AppointmentRow): AppointmentWithPatient {
    const patient = getDb().patients.find((candidate) => candidate.id === row.patientId);

    return {
        ...row,
        patient: {
            id: row.patientId,
            ref: patient?.ref ?? '',
            name: patient?.name ?? '',
            phone: patient?.phone ?? '',
        },
        procedures: linesFor(row.id),
    };
}

function makeRoomForWalkIn(
    branchId: string,
    at: Date,
    durationMinutes: number,
): { startsAt: Date; moved: Dated<RouterOutput['appointment']['walkIn']['moved']> } {
    const db = getDb();

    const running = db.appointments.find(
        (row) =>
            row.branchId === branchId &&
            HOLDS_SLOT.includes(row.status) &&
            row.startsAt.getTime() <= at.getTime() &&
            endOf(row) > at.getTime(),
    );

    const startsAt = running ? new Date(endOf(running)) : at;

    const later = db.appointments
        .filter(
            (row) => row.branchId === branchId && HOLDS_SLOT.includes(row.status) && row.startsAt >= startsAt,
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    let cursor = startsAt.getTime() + durationMinutes * 60_000;
    const moved: Dated<RouterOutput['appointment']['walkIn']['moved']> = [];

    for (const row of later) {
        if (row.startsAt.getTime() >= cursor) break;

        moved.push({ id: row.id, from: row.startsAt, to: new Date(cursor) });
        cursor += row.durationMinutes * 60_000;
    }

    for (const move of moved) {
        const row = requireRow(move.id);
        row.startsAt = move.to;
    }

    return { startsAt, moved };
}

export const appointmentHandlers = {
    byDate(input: RouterInput['appointment']['byDate']): AppointmentWithPatient[] {
        const { from, to } = dayRange(input.date, input.offsetMinutes ?? 0);

        return getDb()
            .appointments.filter(
                (row) =>
                    row.startsAt >= from &&
                    row.startsAt < to &&
                    !row.isOpeningBalance &&
                    (input.branchId ? row.branchId === input.branchId : true),
            )
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
            .map(withPatient);
    },

    byId(input: RouterInput['appointment']['byId']): AppointmentWithPatient {
        return withPatient(requireRow(input.id));
    },

    missed(input: RouterInput['appointment']['missed']): AppointmentWithPatient[] {
        const now = Date.now();

        return getDb()
            .appointments.filter(
                (row) =>
                    row.status === 'booked' &&
                    endOf(row) < now &&
                    (input?.branchId ? row.branchId === input.branchId : true),
            )
            .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
            .slice(0, input?.limit ?? 100)
            .map(withPatient);
    },

    create(input: RouterInput['appointment']['create']): AppointmentRow {
        const durationMinutes = resolveDuration(input.durationMinutes);
        const { reminderLeadHours } = settingsHandlers.get();
        const startsAt = new Date(input.startsAt);
        const offsetMinutes = input.offsetMinutes ?? 0;

        assertSlotFree({ startsAt, durationMinutes, branchId: input.branchId });

        const patientId = resolvePatient(input.patient);

        const row = insertAppointment(
            {
                patientId,
                branchId: input.branchId,
                startsAt,
                durationMinutes,
                note: input.note ?? null,
                status: 'booked',
                channel: 'desk',
                labStatus: input.needsLab ? 'pending' : null,
                isOpeningBalance: false,
                isImported: false,
                dateUnknown: false,
            },
            offsetMinutes,
        );

        replaceProcedures(row.id, input.procedures ?? []);
        takeNext(patientId, row.id);
        scheduleReminderFor(row, reminderLeadHours);

        save();
        broadcast(WS_EVENT.APPOINTMENT_CREATED);
        return row;
    },

    walkIn(input: RouterInput['appointment']['walkIn']): Dated<RouterOutput['appointment']['walkIn']> {
        const durationMinutes = resolveDuration(input.durationMinutes);
        const { reminderLeadHours } = settingsHandlers.get();
        const offsetMinutes = input.offsetMinutes ?? 0;
        const arrivedAt = new Date();

        const patientId = resolvePatient(input.patient);

        const { startsAt, moved } = makeRoomForWalkIn(input.branchId, arrivedAt, durationMinutes);

        const appointment = insertAppointment(
            {
                patientId,
                branchId: input.branchId,
                startsAt,
                durationMinutes,
                note: input.note ?? null,
                status: 'booked',
                channel: 'walk_in',
                labStatus: input.needsLab ? 'pending' : null,
                isOpeningBalance: false,
                isImported: false,
                dateUnknown: false,
            },
            offsetMinutes,
        );

        replaceProcedures(appointment.id, input.procedures ?? []);
        takeNext(patientId, appointment.id);
        scheduleReminderFor(appointment, reminderLeadHours);
        skipReminderFor(appointment.id);

        const visit = visitHandlers.checkIn({ appointmentId: appointment.id, offsetMinutes });

        save();
        broadcast(WS_EVENT.APPOINTMENT_CREATED);
        for (const _move of moved) broadcast(WS_EVENT.APPOINTMENT_UPDATED);

        return { appointment, visitId: visit.id, moved };
    },

    update(input: RouterInput['appointment']['update']): AppointmentRow {
        const { id, startsAt: requestedStart, procedures, needsLab, ...patch } = input;
        const current = requireRow(id);

        if (patch.status && !canTransition(current.status, patch.status)) {
            throw new DemoError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot go from ${current.status} to ${patch.status}`,
                422,
            );
        }

        const moves =
            requestedStart !== undefined ||
            patch.durationMinutes !== undefined ||
            patch.branchId !== undefined;
        if (moves && current.status !== 'booked') {
            throw new DemoError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot move an appointment that is ${current.status}`,
                409,
            );
        }

        const durationMinutes =
            patch.durationMinutes === undefined ? undefined : resolveDuration(patch.durationMinutes);
        const startsAt = requestedStart ? new Date(requestedStart) : undefined;

        if (startsAt || durationMinutes) {
            assertSlotFree(
                {
                    startsAt: startsAt ?? current.startsAt,
                    durationMinutes: durationMinutes ?? current.durationMinutes,
                    branchId: patch.branchId ?? current.branchId,
                },
                id,
            );
        }

        assignDefined(current, patch, {
            ...(startsAt ? { startsAt } : {}),
            ...(durationMinutes ? { durationMinutes } : {}),
            updatedAt: new Date(),
        });
        if (needsLab !== undefined) current.labStatus = needsLab ? (current.labStatus ?? 'pending') : null;

        if (procedures !== undefined) replaceProcedures(id, procedures);
        if (startsAt) rescheduleReminder(id, startsAt);
        if (patch.status === 'no_show') skipReminderFor(id);

        save();
        broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        return current;
    },

    markLabReady(input: RouterInput['appointment']['markLabReady']): AppointmentRow {
        const current = requireRow(input.id);
        if (current.labStatus !== 'pending') return current;

        current.labStatus = 'ready';
        current.updatedAt = new Date();

        save();
        broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        return current;
    },

    cancel(input: RouterInput['appointment']['cancel']): AppointmentRow {
        const current = requireRow(input.id);

        if (!canTransition(current.status, 'cancelled')) {
            throw new DemoError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot cancel an appointment that is ${current.status}`,
                422,
            );
        }

        current.status = 'cancelled';
        current.updatedAt = new Date();
        skipReminderFor(current.id);

        save();
        broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        return current;
    },

    awaitPayment(input: RouterInput['appointment']['awaitPayment']): AppointmentRow {
        const current = requireRow(input.id);

        if (!canTransition(current.status, 'awaiting_payment')) {
            throw new DemoError(
                ERROR_CODE.INVALID_STATUS_TRANSITION,
                `cannot await payment on an appointment that is ${current.status}`,
                422,
            );
        }

        const now = new Date();

        const visit = getDb().visits.find((row) => row.appointmentId === current.id);
        const wasInChair = Boolean(visit?.inChairAt);

        current.status = 'awaiting_payment';
        current.updatedAt = now;
        if (wasInChair) {
            seatNextInChair(current.branchId, clinicDayOf(current.startsAt, input.offsetMinutes ?? 0), now);
        }

        save();
        broadcast(WS_EVENT.APPOINTMENT_UPDATED);
        return current;
    },
};
