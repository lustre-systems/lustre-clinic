import type { PaymentMethod, Tooth } from '@lustre/shared';
import { errorCodeOf, isOffline, trpcClient } from '../../../api';
import { withoutTeeth } from '../procedures';
import { clinicOffsetNow, offsetForDate } from '../time';
import { RequestError } from './client';
import type {
    Appointment,
    AppointmentRow,
    Branch,
    ClinicDay,
    ClinicSettings,
    NextProcedure,
    Patient,
    PendingReminder,
    ProcedureCategory,
    ProcedureType,
    Visit,
    VisitRow,
    WalkInResult,
} from './types';

export interface BookedProcedure {
    procedureId: string;
    quantity?: number;
    tooth?: Tooth | null;
    note?: string | null;
    quotedPrice?: number | null;
}

export type PatientRef =
    | { kind: 'existing'; patientId: string }
    | {
          kind: 'new';
          name: string;
          phone: string;
          email?: string | null;
          birthDate?: string | null;
          gender?: string | null;
          notes?: string | null;
      };

function shaped<T>(value: unknown): T {
    return value as T;
}

async function wrap<T>(run: () => Promise<unknown>): Promise<T> {
    try {
        return shaped<T>(await run());
    } catch (err) {
        if (err instanceof RequestError) throw err;
        throw new RequestError(errorCodeOf(err), err instanceof Error ? err.message : 'request failed', {
            offline: isOffline(err),
            cause: err,
        });
    }
}

export const api = {
    schedule: (): Promise<ClinicDay[]> => wrap(() => trpcClient.settings.schedule.query()),

    settings: (): Promise<ClinicSettings> => wrap(() => trpcClient.settings.get.query()),

    branches: (): Promise<Branch[]> => wrap(() => trpcClient.branch.list.query({ includeInactive: false })),

    byDate: (date: string): Promise<Appointment[]> =>
        wrap(() =>
            trpcClient.appointment.byDate.query({
                date,
                offsetMinutes: offsetForDate(date),
            }),
        ),

    byDates: (dates: readonly string[]): Promise<Appointment[][]> =>
        wrap(() =>
            Promise.all(
                dates.map((date) =>
                    trpcClient.appointment.byDate.query({
                        date,
                        offsetMinutes: offsetForDate(date),
                    }),
                ),
            ),
        ),

    procedures: (): Promise<ProcedureType[]> => wrap(() => trpcClient.procedure.list.query()),

    procedureTree: (): Promise<ProcedureCategory[]> =>
        wrap(async () => {
            const [tree, settings] = await Promise.all([
                trpcClient.procedure.tree.query({ includeInactive: false }),
                trpcClient.settings.get.query(),
            ]);
            return settings.clinicType === 'general' ? withoutTeeth(tree) : tree;
        }),

    pendingReminders: (): Promise<PendingReminder[]> =>
        wrap(() =>
            trpcClient.reminder.pending.query({
                dueOnly: true,
                limit: 100,
                offsetMinutes: clinicOffsetNow(),
            }),
        ),

    markReminderSent: (id: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.markSent.mutate({ id })),

    markReminderSkipped: (id: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.markSkipped.mutate({ id })),

    dismissRemindersToday: (date: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.dismissToday.mutate({ date })),

    resumeRemindersToday: (date: string): Promise<unknown> =>
        wrap(() => trpcClient.reminder.resumeToday.mutate({ date })),

    searchPatients: (q: string): Promise<Patient[]> =>
        wrap(() => trpcClient.patient.search.query({ q, limit: 8 })),

    checkIn: (appointmentId: string): Promise<VisitRow> =>
        wrap(() => trpcClient.visit.checkIn.mutate({ appointmentId, offsetMinutes: clinicOffsetNow() })),

    walkIn: (input: {
        patient: PatientRef;
        branchId: string;
        durationMinutes?: number;
        procedures?: BookedProcedure[];
        note?: string | null;
        needsLab?: boolean;
        offsetMinutes: number;
    }): Promise<WalkInResult> => wrap(() => trpcClient.appointment.walkIn.mutate(input)),

    create: (input: {
        patient: PatientRef;
        branchId: string;
        startsAt: string;
        durationMinutes?: number;
        procedures?: BookedProcedure[];
        note?: string | null;
        needsLab?: boolean;
        offsetMinutes: number;
    }): Promise<AppointmentRow> => wrap(() => trpcClient.appointment.create.mutate(input)),

    cancel: (id: string): Promise<AppointmentRow> => wrap(() => trpcClient.appointment.cancel.mutate({ id })),

    markNoShow: (id: string): Promise<AppointmentRow> =>
        wrap(() => trpcClient.appointment.update.mutate({ id, status: 'no_show' })),

    reschedule: (input: {
        id: string;
        startsAt?: string;
        durationMinutes?: number;
        branchId?: string;
        procedures?: BookedProcedure[];
        note?: string | null;
    }): Promise<AppointmentRow> => wrap(() => trpcClient.appointment.update.mutate(input)),

    setNeedsLab: (id: string, needsLab: boolean): Promise<AppointmentRow> =>
        wrap(() => trpcClient.appointment.update.mutate({ id, needsLab })),

    markLabReady: (id: string): Promise<AppointmentRow> =>
        wrap(() => trpcClient.appointment.markLabReady.mutate({ id })),

    awaitPayment: (id: string): Promise<AppointmentRow> =>
        wrap(() => trpcClient.appointment.awaitPayment.mutate({ id, offsetMinutes: clinicOffsetNow() })),

    setProcedures: (input: {
        visitId: string;
        procedures: Array<{
            procedureId: string;
            quantity?: number;
            unitPrice?: number;
            tooth?: Tooth | null;
            note?: string | null;
        }>;
        nextProcedures?: Array<{ procedureId: string; tooth: Tooth | null }>;
    }): Promise<Visit> => wrap(() => trpcClient.visit.setProcedures.mutate(input)),

    pendingNextProcedures: (patientId: string): Promise<NextProcedure[]> =>
        wrap(() => trpcClient.visit.pendingNextProcedures.query({ patientId })),

    checkOut: (input: {
        visitId: string;
        chargedTotal: number;
        paidTotal: number;
        method: PaymentMethod;
        methodNote?: string | null;
    }): Promise<Visit> =>
        wrap(() => trpcClient.visit.checkOut.mutate({ ...input, offsetMinutes: clinicOffsetNow() })),

    setPaid: (input: {
        visitId: string;
        paidTotal: number;
        method: PaymentMethod;
        methodNote?: string | null;
    }): Promise<Visit> => wrap(() => trpcClient.visit.setPaid.mutate(input)),

    setPaidMethod: (input: {
        visitId: string;
        method: PaymentMethod;
        methodNote?: string | null;
    }): Promise<Visit> => wrap(() => trpcClient.visit.setPaidMethod.mutate(input)),

    visitById: (id: string): Promise<Visit> => wrap(() => trpcClient.visit.byId.query({ id })),

    appointmentById: (id: string): Promise<Appointment> =>
        wrap(() => trpcClient.appointment.byId.query({ id })),

    reopenVisit: (visitId: string): Promise<Visit> => wrap(() => trpcClient.visit.reopen.mutate({ visitId })),

    deleteVisit: (visitId: string): Promise<void> =>
        wrap(() => trpcClient.visit.delete.mutate({ visitId, offsetMinutes: clinicOffsetNow() })),

    deletePayment: (paymentId: string): Promise<Visit> =>
        wrap(() => trpcClient.visit.deletePayment.mutate({ paymentId })),
};

export async function arrive(input: {
    appointmentId: string;
    procedures: Array<{ procedureId: string; quantity: number; unitPrice: number; tooth: Tooth | null }>;
    edited: boolean;
    note?: string | null;
}): Promise<Visit> {
    await writeNote(input.appointmentId, input.note);

    const row = await api.checkIn(input.appointmentId);
    rememberVisit(input.appointmentId, row.id);

    if (!input.edited) return api.visitById(row.id);
    return api.setProcedures({ visitId: row.id, procedures: input.procedures });
}

async function writeNote(appointmentId: string, note: string | null | undefined): Promise<void> {
    if (note === undefined) return;
    await api.reschedule({ id: appointmentId, note });
}

export async function amend(input: {
    visitId: string;
    appointmentId: string;
    closed: boolean;
    procedures: Array<{ procedureId: string; quantity: number; unitPrice: number; tooth: Tooth | null }>;
    note?: string | null;
    nextProcedures?: Array<{ procedureId: string; tooth: Tooth | null }>;
}): Promise<Visit> {
    await writeNote(input.appointmentId, input.note);

    if (input.closed) {
        const current = await api.visitById(input.visitId);
        if (current.completedAt) await api.reopenVisit(input.visitId);
    }

    return api.setProcedures({
        visitId: input.visitId,
        procedures: input.procedures,
        nextProcedures: input.nextProcedures,
    });
}

export async function closeVisit(
    input: Parameters<typeof api.checkOut>[0] & { closed: boolean },
): Promise<Visit> {
    const { closed, ...checkOut } = input;
    if (closed) {
        const current = await api.visitById(checkOut.visitId);
        if (current.completedAt) await api.reopenVisit(checkOut.visitId);
    }
    return api.checkOut(checkOut);
}

const visitIds = new Map<string, string>();

function rememberVisit(appointmentId: string, visitId: string): void {
    visitIds.set(appointmentId, visitId);
}

export interface Arrivals {
    checkedInAt: ReadonlyMap<string, string>;
    inChairAt: ReadonlyMap<string, string>;
}

async function visitRowForAppointment(appointmentId: string): Promise<VisitRow | null> {
    const row = await wrap<VisitRow | null>(() => trpcClient.visit.byAppointment.query({ appointmentId }));
    if (row) visitIds.set(appointmentId, row.id);
    return row;
}

export async function checkInTimes(appointmentIds: readonly string[]): Promise<Arrivals> {
    const visits = await Promise.all(
        appointmentIds.map((id) => visitRowForAppointment(id).catch(() => null)),
    );

    const checkedInAt = new Map<string, string>();
    const inChairAt = new Map<string, string>();

    visits.forEach((visit, index) => {
        const id = appointmentIds[index];
        if (!visit || !id) return;
        checkedInAt.set(id, visit.checkedInAt);
        if (visit.inChairAt) inChairAt.set(id, visit.inChairAt);
    });

    return { checkedInAt, inChairAt };
}

export async function visitForAppointment(appointmentId: string): Promise<Visit | null> {
    const known = visitIds.get(appointmentId) ?? (await visitRowForAppointment(appointmentId))?.id;
    return known ? api.visitById(known) : null;
}
