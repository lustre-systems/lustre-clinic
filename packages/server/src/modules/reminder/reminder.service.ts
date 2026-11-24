import {
    callerWallClock,
    type LabStatus,
    pad2,
    reminderDueCutoff,
    renderReminderTemplate,
    type WhatsAppApp,
    WS_EVENT,
} from '@lustre/shared';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { appointments, branches, patients, reminders } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { toWhatsAppNumber } from '../../util/phone.ts';
import { broadcast } from '../../ws/index.ts';
import { settingsService } from '../settings/settings.service.ts';
import type { DismissTodayInput, PendingRemindersInput } from './reminder.schema.ts';

type Reminder = typeof reminders.$inferSelect;

interface PendingReminder {
    id: string;
    appointmentId: string;
    dueAt: Date;
    startsAt: Date;
    ref: string;
    patient: { id: string; name: string; phone: string };
    whatsAppUrl: string;
    whatsappApp: WhatsAppApp;
    message: string;
    labStatus: LabStatus | null;
}

export const reminderService = {
    async scheduleFor(
        executor: Executor,
        appointment: { id: string; startsAt: Date },
        leadHours: number,
    ): Promise<void> {
        const dueAt = new Date(appointment.startsAt.getTime() - leadHours * 3_600_000);

        await executor
            .insert(reminders)
            .values({ id: Bun.randomUUIDv7(), appointmentId: appointment.id, dueAt })
            .onConflictDoUpdate({ target: reminders.appointmentId, set: { dueAt } });
    },

    async reschedule(
        executor: Executor,
        appointmentId: string,
        startsAt: Date,
        leadHours: number,
    ): Promise<void> {
        await executor
            .update(reminders)
            .set({ dueAt: new Date(startsAt.getTime() - leadHours * 3_600_000) })
            .where(eq(reminders.appointmentId, appointmentId));
    },

    async rescheduleAllPending(executor: Executor, leadHours: number): Promise<void> {
        await executor
            .update(reminders)
            .set({ dueAt: sql`${appointments.startsAt} - make_interval(hours => ${leadHours})` })
            .from(appointments)
            .where(
                and(
                    eq(reminders.appointmentId, appointments.id),
                    eq(reminders.status, 'pending'),
                    eq(appointments.status, 'booked'),
                    gt(appointments.startsAt, sql`now()`),
                ),
            );
    },

    async skipFor(executor: Executor, appointmentId: string): Promise<void> {
        await executor
            .update(reminders)
            .set({ status: 'skipped' })
            .where(and(eq(reminders.appointmentId, appointmentId), eq(reminders.status, 'pending')));
    },

    async pending(
        input: PendingRemindersInput = { dueOnly: true, limit: 100, offsetMinutes: 0 },
    ): Promise<PendingReminder[]> {
        const settings = await settingsService.get();
        const cutoff = reminderDueCutoff({
            now: new Date(),
            notifyAt: settings.reminderNotifyAt,
            offsetMinutes: input.offsetMinutes,
            throughToday: input.throughToday,
        });

        const rows = await db
            .select({
                id: reminders.id,
                appointmentId: reminders.appointmentId,
                dueAt: reminders.dueAt,
                startsAt: appointments.startsAt,
                ref: appointments.ref,
                status: appointments.status,
                labStatus: appointments.labStatus,
                branch: branches.name,
                patientId: patients.id,
                name: patients.name,
                phone: patients.phone,
                whatsappApp: branches.whatsappApp,
            })
            .from(reminders)
            .innerJoin(appointments, eq(reminders.appointmentId, appointments.id))
            .innerJoin(branches, eq(appointments.branchId, branches.id))
            .innerJoin(patients, eq(appointments.patientId, patients.id))
            .where(
                and(
                    eq(reminders.status, 'pending'),
                    eq(appointments.status, 'booked'),
                    ...(input.dueOnly ? [lte(reminders.dueAt, cutoff)] : []),
                ),
            )
            .orderBy(asc(reminders.dueAt))
            .limit(input.limit);

        return rows.map((row) => {
            const wall = callerWallClock(row.startsAt, input.offsetMinutes);

            const message = renderReminderTemplate(settings.reminderTemplate, {
                name: row.name,
                clinic: settings.clinicName,
                branch: row.branch,
                date: wall.key,
                time: `${pad2(Math.floor(wall.minutes / 60))}:${pad2(wall.minutes % 60)}`,
                ref: row.ref,
            });

            return {
                id: row.id,
                appointmentId: row.appointmentId,
                dueAt: row.dueAt,
                startsAt: row.startsAt,
                ref: row.ref,
                patient: { id: row.patientId, name: row.name, phone: row.phone },
                whatsAppUrl: `https://wa.me/${toWhatsAppNumber(row.phone)}?text=${encodeURIComponent(message)}`,
                whatsappApp: row.whatsappApp,
                message,
                labStatus: row.labStatus,
            };
        });
    },

    async markSent(id: string): Promise<Reminder> {
        const [row] = await db
            .update(reminders)
            .set({ status: 'sent', sentAt: new Date() })
            .where(eq(reminders.id, id))
            .returning();

        if (!row) throw AppError.notFound('reminder');
        broadcast(WS_EVENT.REMINDER_UPDATED, { id });
        return row;
    },

    async markSkipped(id: string): Promise<Reminder> {
        const [row] = await db
            .update(reminders)
            .set({ status: 'skipped' })
            .where(eq(reminders.id, id))
            .returning();

        if (!row) throw AppError.notFound('reminder');
        broadcast(WS_EVENT.REMINDER_UPDATED, { id });
        return row;
    },

    async dismissToday(input: DismissTodayInput) {
        return settingsService.dismissRemindersFor(input.date);
    },

    async resumeToday(input: DismissTodayInput) {
        return settingsService.resumeRemindersFor(input.date);
    },
};
