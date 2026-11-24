import { type Role, seesPayments, todayKey } from '@lustre/shared';
import { count, eq, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { appointments, patients, visits } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { assertAmount } from '../../util/money.ts';
import { branchService } from '../branch/branch.service.ts';
import type { OldPatientInput } from '../patient/patient.schema.ts';

const SYNTHETIC_DURATION_MINUTES = 5;

const OPENING_BALANCE_NOTE = 'Opening balance carried over from the old system';

interface OldPatientPlan {
    branchId: string;
    cutoffDate: string;
    openingBalance: number;
}

function noonUtc(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

export async function planOldPatientHistory(
    old: Pick<OldPatientInput, 'openingBalance'>,
): Promise<OldPatientPlan | null> {
    if (old.openingBalance === undefined) return null;
    assertAmount(old.openingBalance, 'opening balance');

    return {
        branchId: await defaultBranchId(),
        cutoffDate: todayKey(),
        openingBalance: old.openingBalance,
    };
}

export async function defaultBranchId(): Promise<string> {
    const [branch] = await branchService.list();
    if (!branch) throw AppError.notFound('branch');
    return branch.id;
}

export async function writeOldPatientHistory(
    tx: Executor,
    patientId: string,
    plan: OldPatientPlan,
): Promise<void> {
    const { insertWithRef } = await import('../appointment/appointment.service.ts');

    const cutoffAt = noonUtc(plan.cutoffDate);

    const appointment = await insertWithRef(
        tx,
        {
            patientId,
            branchId: plan.branchId,
            startsAt: cutoffAt,
            durationMinutes: SYNTHETIC_DURATION_MINUTES,
            status: 'done',
            isOpeningBalance: true,
            note: OPENING_BALANCE_NOTE,
        },
        0,
    );

    const [visit] = await tx
        .insert(visits)
        .values({
            id: Bun.randomUUIDv7(),
            appointmentId: appointment.id,
            checkedInAt: cutoffAt,
            pricedAt: cutoffAt,
            completedAt: cutoffAt,
            computedTotal: plan.openingBalance,
            chargedTotal: plan.openingBalance,
        })
        .returning();

    if (!visit) throw AppError.internal('opening balance visit insert returned nothing');
}

interface MigrationProgress {
    patients: number;
    oldPatients: number;
    openingBalances: number;
    openingBalanceTotal: number | null;
}

export const migrationService = {
    async progress(viewer?: Role | null): Promise<MigrationProgress> {
        const [entered] = await db.select({ total: count() }).from(patients);

        const [old] = await db
            .select({ total: count() })
            .from(patients)
            .where(sql`${patients.legacyRef} IS NOT NULL`);

        const [carried] = await db
            .select({
                total: count(),
                amount: sql<number>`COALESCE(SUM(${visits.chargedTotal}), 0)::int`,
            })
            .from(visits)
            .innerJoin(appointments, eq(visits.appointmentId, appointments.id))
            .where(eq(appointments.isOpeningBalance, true));

        return {
            patients: entered?.total ?? 0,
            oldPatients: old?.total ?? 0,
            openingBalances: carried?.total ?? 0,
            openingBalanceTotal: viewer === undefined || seesPayments(viewer) ? (carried?.amount ?? 0) : null,
        };
    },
};
