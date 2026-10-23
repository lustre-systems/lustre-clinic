/**
 * `server/src/modules/migration/migration.service.ts` — what a patient who
 * predates the cutoff brings with them, written by `patient.create` when the
 * **Old patient** switch is on. There is no `enter` procedure any more: two
 * ways to register an old patient is how one of them ends up allocating a fresh
 * number to somebody who already has one.
 *
 * A balance is derived and never stored, so debt carried over from before the
 * cutoff has nowhere of its own to live: it is given a synthetic appointment
 * and visit, dated at the cutoff, charged with what is owed and carrying no
 * procedures. `isOpeningBalance` is how the readers tell it apart. It is
 * `done` rather than `booked` — `done` holds no slot, so any number of them at
 * the same instant do not collide.
 */
import { ERROR_CODE, todayKey } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, type VisitRow } from '../db';
import { assertAmount, DemoError, uuidv7 } from '../rules';
import type { Dated } from '../wire';
import { insertAppointment } from './appointmentRow';
import { branchHandlers } from './branch';

type OldPatientInput = NonNullable<RouterInput['patient']['create']['old']>;

/** Nominal: nobody attended and the day view never draws these, but a duration must be positive. */
const SYNTHETIC_DURATION_MINUTES = 5;

const OPENING_BALANCE_NOTE = 'Opening balance carried over from the old system';

/**
 * Midday on the day this names, in UTC — the same trick the server uses. These
 * rows carry a date rather than occupying a slot, and noon reads back as that
 * day at every offset strictly between −12 and +12. See `migration.service`.
 */
function noonUtc(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

/**
 * Everything the write needs, checked before a row is touched — the same order
 * the server resolves it in, so a demo refuses what the clinic would refuse.
 */
export function planOldPatientHistory(old: Pick<OldPatientInput, 'openingBalance'>): {
    branchId: string;
    cutoffDate: string;
    openingBalance: number;
} | null {
    if (old.openingBalance === undefined) return null;
    assertAmount(old.openingBalance, 'opening balance');

    // Dated on the day it is entered, at the first active branch — the server's
    // rule since the cutoff left Settings → Clinic.
    const branchId = branchHandlers.list({ includeInactive: false })[0]?.id;
    if (!branchId) throw new DemoError(ERROR_CODE.NOT_FOUND, 'branch not found', 404);

    return { branchId, cutoffDate: todayKey(), openingBalance: old.openingBalance };
}

/** Writes a resolved plan against a patient that already exists. */
export function writeOldPatientHistory(
    patientId: string,
    plan: NonNullable<ReturnType<typeof planOldPatientHistory>>,
): void {
    const db = getDb();
    const cutoffAt = noonUtc(plan.cutoffDate);

    const appointment = insertAppointment(
        {
            patientId,
            branchId: plan.branchId,
            startsAt: cutoffAt,
            durationMinutes: SYNTHETIC_DURATION_MINUTES,
            note: OPENING_BALANCE_NOTE,
            status: 'done',
            channel: 'desk',
            isOpeningBalance: true,
            isImported: false,
            dateUnknown: false,
        },
        0,
    );

    const visit: VisitRow = {
        id: uuidv7(),
        appointmentId: appointment.id,
        checkedInAt: cutoffAt,
        inChairAt: null,
        // Settled from the moment it exists: there is nothing here to price,
        // and the amount is whatever the old system said.
        pricedAt: cutoffAt,
        completedAt: cutoffAt,
        computedTotal: plan.openingBalance,
        chargedTotal: plan.openingBalance,
        nextProcedures: [],
        nextAppointmentId: null,
        createdAt: cutoffAt,
    };
    db.visits.push(visit);
}

export const migrationHandlers = {
    /** `patients` is the whole register; `oldPatients` is how many came across. */
    progress(): Dated<RouterOutput['migration']['progress']> {
        const db = getDb();

        const carried = db.visits.filter((visit) =>
            db.appointments.some((row) => row.id === visit.appointmentId && row.isOpeningBalance),
        );

        return {
            patients: db.patients.length,
            oldPatients: db.patients.filter((row) => row.legacyRef !== null).length,
            openingBalances: carried.length,
            openingBalanceTotal: carried.reduce((sum, visit) => sum + visit.chargedTotal, 0),
        };
    },
};
