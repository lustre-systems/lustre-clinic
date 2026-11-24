import type { Tooth } from '@lustre/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { appointments, visits } from '../../db/schema.ts';
import { appointmentService } from '../appointment/appointment.service.ts';
import { visitService } from '../visit/visit.service.ts';

type Reach = 'waiting' | 'chair' | 'desk';

interface LiveArrival {
    patientId: string;
    branchId: string;
    startsAt: Date;
    durationMinutes: number;
    procedures: { procedureId: string; quantity?: number; tooth?: Tooth; note?: string }[];
    arrivedAgo: number;
    seatedAgo?: number;
    reach: Reach;
    channel?: 'desk' | 'walk_in';
    note?: string;
}

interface LiveSeatResult {
    appointmentId: string;
    visitId: string;
}

function minutesAgo(minutes: number): Date {
    return new Date(Math.floor(Date.now() / 60_000) * 60_000 - minutes * 60_000);
}

export const seedService = {
    async liveDay(arrivals: readonly LiveArrival[]): Promise<LiveSeatResult[]> {
        const seated: LiveSeatResult[] = [];

        for (const arrival of arrivals) {
            const procedures = arrival.procedures.map((line) => ({
                procedureId: line.procedureId,
                quantity: line.quantity ?? 1,
                tooth: line.tooth ?? null,
                note: line.note ?? null,
            }));

            if (arrival.channel === 'walk_in') {
                const result = await appointmentService.walkIn({
                    patient: { kind: 'existing', patientId: arrival.patientId },
                    branchId: arrival.branchId,
                    durationMinutes: arrival.durationMinutes,
                    procedures,
                    note: arrival.note ?? null,
                    offsetMinutes: 0,
                });
                seated.push({ appointmentId: result.appointment.id, visitId: result.visitId });
                continue;
            }

            const appointment = await appointmentService.create({
                patient: { kind: 'existing', patientId: arrival.patientId },
                branchId: arrival.branchId,
                startsAt: arrival.startsAt.toISOString(),
                durationMinutes: arrival.durationMinutes,
                procedures,
                note: arrival.note ?? null,
                offsetMinutes: 0,
            });

            const visit = await visitService.checkIn({ appointmentId: appointment.id });
            seated.push({ appointmentId: appointment.id, visitId: visit.id });
        }

        for (const [index, arrival] of arrivals.entries()) {
            if (arrival.reach !== 'desk') continue;
            const row = seated[index];
            if (row) await appointmentService.awaitPayment(row.appointmentId);
        }

        await backdate(arrivals, seated);
        return seated;
    },
};

async function backdate(arrivals: readonly LiveArrival[], seated: readonly LiveSeatResult[]): Promise<void> {
    for (const [index, arrival] of arrivals.entries()) {
        const row = seated[index];
        if (!row) continue;

        const arrivedAt = minutesAgo(arrival.arrivedAgo);
        const seatedAt = arrival.seatedAgo === undefined ? null : minutesAgo(arrival.seatedAgo);

        await db
            .update(visits)
            .set({ checkedInAt: arrivedAt, ...(seatedAt ? { inChairAt: seatedAt } : {}) })
            .where(eq(visits.id, row.visitId));

        await db
            .update(appointments)
            .set({ updatedAt: seatedAt ?? arrivedAt })
            .where(eq(appointments.id, row.appointmentId));
    }
}
