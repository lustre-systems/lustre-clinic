/**
 * What a patient who predates the cutoff brings with them: the money they
 * already owed. It is written by `patient.create` when the **Old patient**
 * switch is on, and nothing else writes it — the separate Settings → Data entry screen and its
 * `migration.enter` procedure are gone, because two ways to register an old
 * patient is how one of them ends up allocating a fresh number to someone who
 * already has one.
 *
 * ## Where it is dated
 *
 * `branch_id` is NOT NULL and a date has to be something. Both are the day of
 * registration in the clinic's zone, at the clinic's first active branch — the
 * same branch an old visit falls back to. Past work is an old visit, entered
 * whenever it surfaces, so the only thing registration carries over is what
 * they owe, and that is owed from the day it is entered.
 *
 * The row is stamped at **noon UTC** on that day, which reads back as the same
 * day at every offset strictly between −12 and +12 — Egypt is +2 or +3, and
 * keeps DST, so local midnight would not.
 *
 * ## Opening balances
 *
 * A balance is derived and never stored — `charged_total` minus payments, per
 * visit (§10) — so debt carried over from before the cutoff has nowhere of its
 * own to live. It is given a synthetic appointment and a synthetic visit, dated
 * at the cutoff, charged with what is owed and carrying no procedures. The
 * appointment is flagged `is_opening_balance`, which is how the readers tell it
 * apart: it is owed, so `balance.outstanding` and the patient's record count
 * it, but nothing was billed and nobody sat in the chair, so `balance.summary`,
 * `stats.summary` and the day view leave it out.
 *
 * The synthetic appointment is `done` rather than `booked`. `done` does not
 * hold a slot, so any number of them at the same instant do not trip
 * `appointments_no_overlap`.
 *
 * Every part of this is written in the caller's transaction. A patient on file
 * owing nothing they actually owe is a wrong number told to them at the desk
 * months later, so if any of it cannot be written none of it is, the patient
 * included, and the row is typed again.
 */
import { type Role, seesPayments, todayKey } from '@lustre/shared';
import { count, eq, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { appointments, patients, visits } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { assertAmount } from '../../util/money.ts';
import { branchService } from '../branch/branch.service.ts';
import type { OldPatientInput } from '../patient/patient.schema.ts';

/** Nominal. Nobody attended and the day view never draws these, but the column is NOT NULL and checked positive. */
const SYNTHETIC_DURATION_MINUTES = 5;

/** English, for logs and for the appointment detail screen if anyone ever opens one of these. */
const OPENING_BALANCE_NOTE = 'Opening balance carried over from the old system';

/** Everything the write needs, resolved and checked before a transaction is open. */
interface OldPatientPlan {
    branchId: string;
    /** The day the opening balance is stamped on: registration day, the clinic's. */
    cutoffDate: string;
    openingBalance: number;
}

function noonUtc(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

/**
 * Resolves what an old patient brings with them, and refuses it here if it
 * cannot be written — before the patient row exists, so there is nothing to
 * roll back. Null when they arrive owing nothing, which is most of them.
 */
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

/**
 * Where a row the caller gave no branch for hangs. `branch_id` is NOT NULL and
 * a clinic with one branch should not be made to answer a question it has only
 * one answer to; the list is ordered by name, so the fallback is stable rather
 * than whichever row came back first.
 */
export async function defaultBranchId(): Promise<string> {
    const [branch] = await branchService.list();
    if (!branch) throw AppError.notFound('branch');
    return branch.id;
}

/**
 * Writes the plan against a patient that already exists, in the caller's
 * transaction. `insertWithRef` is imported here rather than at the top of the
 * file: `patient.create` calls into this module and `appointment.service`
 * imports `patient.service`, so a static import would close a cycle between the
 * three.
 */
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
            // Settled from the moment it exists: there is nothing here
            // to price, and the amount is whatever the old system said.
            pricedAt: cutoffAt,
            completedAt: cutoffAt,
            computedTotal: plan.openingBalance,
            chargedTotal: plan.openingBalance,
        })
        .returning();

    if (!visit) throw AppError.internal('opening balance visit insert returned nothing');
}

/** How far the changeover has got. Settings → Clinic draws it beside the cutoff it is dated at. */
interface MigrationProgress {
    patients: number;
    oldPatients: number;
    openingBalances: number;
    /** What the carried-over debt comes to. Null for a viewer not shown payments (a doctor). */
    openingBalanceTotal: number | null;
}

export const migrationService = {
    /**
     * `patients` is the whole register rather than the old ones alone — the two
     * answer different questions: how many came across, and how many are on
     * file at all.
     */
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
