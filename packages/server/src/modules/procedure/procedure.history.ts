import { callerWallClock, ERROR_CODE, WS_EVENT } from '@lustre/shared';
import { db } from '../../db/index.ts';
import { payments, visitProcedures, visits } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { computeTotal } from '../../util/money.ts';
import { broadcast } from '../../ws/index.ts';
import { branchService } from '../branch/branch.service.ts';
import { defaultBranchId } from '../migration/migration.service.ts';
import { patientService } from '../patient/patient.service.ts';
import { settingsService } from '../settings/settings.service.ts';
import { resolveProcedureLines } from './procedure.rules.ts';
import type { AddOldVisitInput } from './procedure.schema.ts';

const OLD_VISIT_NOTE = 'Entered after the day it happened';

function noonUtc(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

interface AddedOldVisit {
    appointmentId: string;
    visitId: string;
    chargedTotal: number;
}

export const procedureHistoryService = {
    async addOldVisit(input: AddOldVisitInput): Promise<AddedOldVisit> {
        await patientService.requireExists(input.patientId);

        const today = callerWallClock(Date.now(), input.offsetMinutes).key;
        if (input.performedOn > today) {
            throw new AppError(
                ERROR_CODE.VALIDATION,
                'an old visit has to be dated on a day that has happened',
                422,
            );
        }

        const lines = await resolveProcedureLines(input.procedures);

        const branchId = input.branchId
            ? (await branchService.byId(input.branchId)).id
            : await defaultBranchId();
        const { defaultDuration } = await settingsService.get();

        const at = noonUtc(input.performedOn);
        const priced = lines.map((line, i) => ({
            procedureId: line.procedure.id,
            quantity: line.quantity,
            unitPrice: input.procedures[i]?.unitPrice ?? line.procedure.defaultPrice,
            unitCost: line.procedure.cost,
            tooth: line.tooth,
            note: line.note,
        }));

        const chargedTotal = computeTotal(
            priced.map((line, i) => ({ ...line, isCheckup: lines[i]?.procedure.isCheckup ?? false })),
        );

        const { insertWithRef } = await import('../appointment/appointment.service.ts');

        const written = await db.transaction(async (tx) => {
            const appointment = await insertWithRef(
                tx,
                {
                    patientId: input.patientId,
                    branchId,
                    startsAt: at,
                    durationMinutes: defaultDuration,
                    status: 'done',
                    channel: 'desk',
                    note: OLD_VISIT_NOTE,
                },
                0,
            );

            const [visit] = await tx
                .insert(visits)
                .values({
                    id: Bun.randomUUIDv7(),
                    appointmentId: appointment.id,
                    checkedInAt: at,
                    inChairAt: at,
                    pricedAt: at,
                    completedAt: at,
                    computedTotal: chargedTotal,
                    chargedTotal,
                })
                .returning();

            if (!visit) throw AppError.internal('old visit insert returned nothing');

            await tx
                .insert(visitProcedures)
                .values(priced.map((line) => ({ id: Bun.randomUUIDv7(), visitId: visit.id, ...line })));

            if (chargedTotal > 0) {
                await tx.insert(payments).values({
                    id: Bun.randomUUIDv7(),
                    visitId: visit.id,
                    amount: chargedTotal,
                    method: 'cash',
                    methodNote: null,
                    paidAt: at,
                });
            }

            return { appointmentId: appointment.id, visitId: visit.id };
        });

        broadcast(WS_EVENT.VISIT_UPDATED, { id: written.visitId });

        return { ...written, chargedTotal };
    },
};
