import { ERROR_CODE, todayKey } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { getDb, type VisitRow } from '../db';
import { assertAmount, DemoError, uuidv7 } from '../rules';
import type { Dated } from '../wire';
import { insertAppointment } from './appointmentRow';
import { branchHandlers } from './branch';

type OldPatientInput = NonNullable<RouterInput['patient']['create']['old']>;

const SYNTHETIC_DURATION_MINUTES = 5;

const OPENING_BALANCE_NOTE = 'Opening balance carried over from the old system';

function noonUtc(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

export function planOldPatientHistory(old: Pick<OldPatientInput, 'openingBalance'>): {
    branchId: string;
    cutoffDate: string;
    openingBalance: number;
} | null {
    if (old.openingBalance === undefined) return null;
    assertAmount(old.openingBalance, 'opening balance');

    const branchId = branchHandlers.list({ includeInactive: false })[0]?.id;
    if (!branchId) throw new DemoError(ERROR_CODE.NOT_FOUND, 'branch not found', 404);

    return { branchId, cutoffDate: todayKey(), openingBalance: old.openingBalance };
}

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
