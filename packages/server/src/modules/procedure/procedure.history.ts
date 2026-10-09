/**
 * A visit that happened on a day that has passed and was never typed in: past
 * work entered from the patient's record rather than at registration.
 */
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

/** English, for logs and for the appointment detail screen if anyone opens one. */
const OLD_VISIT_NOTE = 'Entered after the day it happened';

/**
 * Midday on the day this names, in UTC — the same stamp an opening balance uses
 * and for the same reason: an old visit records *which day*, not which slot, so
 * it has to read back as that day from any offset. See `migration.service`.
 */
function noonUtc(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

interface AddedOldVisit {
    appointmentId: string;
    visitId: string;
    /** What the visit was charged, in piastres — and paid, in cash, on the day. */
    chargedTotal: number;
}

export const procedureHistoryService = {
    /**
     * A visit that happened on a day that has passed and never got typed in.
     *
     * The work was done here, so it lands as an ordinary completed visit: it is
     * charged, the patient owes it, and the day it names counts it. The only
     * thing it does not have is a time of day, because the desk is recording
     * which day it was rather than which slot.
     *
     * It lands **paid**, in full and in cash, dated the day itself. An old
     * visit is almost always one the patient paid for at the desk and nobody
     * typed in; the rarer one they still owe on is corrected on the visit
     * afterwards (`visit.setPaid`, or `visit.deletePayment` for "nothing was
     * taken"), the same way any checkout that recorded the wrong amount is.
     * Dating the payment on the day keeps today's takings to what today took.
     *
     * `done` is what makes a past date writable at all: `appointments_no_overlap`
     * applies only to `booked` and `checked_in`, so a day that is already full
     * of real appointments still takes one of these, and two of them on the same
     * day do not collide with each other.
     *
     */
    async addOldVisit(input: AddOldVisitInput): Promise<AddedOldVisit> {
        await patientService.requireExists(input.patientId);

        // A visit that has not happened is not a record of anything. Dates
        // compare as strings in ISO, and "today" is the clinic's, not the server's.
        const today = callerWallClock(Date.now(), input.offsetMinutes).key;
        if (input.performedOn > today) {
            throw new AppError(
                ERROR_CODE.VALIDATION,
                'an old visit has to be dated on a day that has happened',
                422,
            );
        }

        // §5's rules, the same ones a visit and a booking answer to.
        const lines = await resolveProcedureLines(input.procedures);

        // A named branch is checked here: left to the insert, a missing one is a
        // foreign-key violation and reaches the client as INTERNAL, not NOT_FOUND.
        const branchId = input.branchId
            ? (await branchService.byId(input.branchId)).id
            : await defaultBranchId();
        const { defaultDuration } = await settingsService.get();

        const at = noonUtc(input.performedOn);
        const priced = lines.map((line, i) => ({
            procedureId: line.procedure.id,
            quantity: line.quantity,
            // The caller's price, or the catalogue's — `visit.setProcedures`
            // resolves it the same way, and the snapshot is taken here either
            // way so a later price change cannot rewrite this visit (§7).
            unitPrice: input.procedures[i]?.unitPrice ?? line.procedure.defaultPrice,
            tooth: line.tooth,
            note: line.note,
        }));

        // The checkup waiver, as on any visit (§10): a checkup is free when other work was done.
        const chargedTotal = computeTotal(
            priced.map((line, i) => ({ ...line, isCheckup: lines[i]?.procedure.isCheckup ?? false })),
        );

        // `insertWithRef` is imported here rather than at the top of the file
        // for the reason `migration.service` gives: a static import would close
        // a cycle through `appointment.service` and `patient.service`.
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
                    // Every moment the visit records is the day itself. Nobody
                    // waited and nobody was in the chair now, but the columns
                    // are the record of a visit that did happen.
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

            // Written directly rather than through `visit.service`'s
            // `insertPayment`, which stamps `now` and is on the far side of the
            // import cycle `insertWithRef` is loaded around. A free visit takes
            // no row: `payments_amount_nonzero`.
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
