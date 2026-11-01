/**
 * SPEC §12. One enforced row (§5), seeded on first read so a fresh database is
 * usable without a manual step.
 *
 * `reminder_dismissed_on` lives here too (§11): the daily notification's repeat
 * is suppressed while it equals today. Reminder logic reads it through this
 * service rather than touching the row itself.
 *
 * Postgres returns `time` as `HH:MM:SS`, so rows are trimmed to `HH:MM` for the
 * client. Seeding uses `onConflictDoNothing` to cover two boots racing on an
 * empty database. `defaultDuration` must stay inside `durationOptions` or the
 * picker would offer an unpickable default, and `setDay` resolves the branch
 * first so the client gets a localizable `NOT_FOUND` rather than a foreign-key
 * violation.
 *
 * `patient_ref_next` is the number the next *new* patient is given. It was
 * `patient_ref_last` — the number already handed out — and the field was read
 * as this one by everybody who typed into it, which is how a clinic that typed
 * 910 got 911. An old patient keeps their own number and never moves it.
 */
import {
    type ClinicType,
    DEFAULT_CLINIC_NAME,
    DEFAULT_REMINDER_TEMPLATE,
    DEFAULT_REQUIRE_AGE,
    DEFAULT_REQUIRE_GENDER,
    ERROR_CODE,
    managesClinic,
    type Role,
    WS_EVENT,
} from '@lustre/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { db, type Executor } from '../../db/index.ts';
import { clinicDays, patients, settings } from '../../db/schema.ts';
import { AppError } from '../../errors/AppError.ts';
import { highestNumericRef } from '../../util/ref.ts';
import { broadcast } from '../../ws/index.ts';
import { branchService } from '../branch/branch.service.ts';
import { reminderService } from '../reminder/reminder.service.ts';
import type { SetClinicDayInput, UpdateSettingsInput } from './settings.schema.ts';

interface Settings {
    clinicName: string;
    clinicPhone: string | null;
    durationOptions: number[];
    defaultDuration: number;
    reminderLeadHours: number;
    reminderNotifyAt: string;
    reminderRepeatMinutes: number;
    reminderDismissedOn: string | null;
    reminderTemplate: string;
    /** The number the next new patient is given — handed out as it stands, not one more. */
    patientRefNext: number;
    /** A registration is refused without an age. Records already on file without one are left alone. */
    requireAge: boolean;
    /** The same for a sex. */
    requireGender: boolean;
    /** Whether the doctor's Finish asks first if the procedures need editing. */
    askToEditOnFinish: boolean;
    /** `general`: no procedure asks for a tooth, whatever the catalogue says (`procedure.rules.ts`). */
    clinicType: ClinicType;
    /** Whether a phone with no role credential is refused. Changed only by an admin (`device.setRequireProvisioning`). */
    requireProvisioning: boolean;
    updatedAt: Date;
}

/** What a patient must carry to be registered, under this clinic's settings. */
export interface PatientRequirements {
    requireAge: boolean;
    requireGender: boolean;
}

type SettingsRow = typeof settings.$inferSelect;

/** The fields of `update` that set the clinic up (`managesClinic`). */
const CLINIC_FIELDS = [
    'clinicName',
    'clinicPhone',
    'patientRefNext',
    'requireAge',
    'requireGender',
    'clinicType',
] as const satisfies readonly (keyof UpdateSettingsInput)[];

function toSettings(row: SettingsRow): Settings {
    return {
        clinicName: row.clinicName,
        clinicPhone: row.clinicPhone,
        durationOptions: [...row.durationOptions].sort((a, b) => a - b),
        defaultDuration: row.defaultDuration,
        reminderLeadHours: row.reminderLeadHours,
        reminderNotifyAt: row.reminderNotifyAt.slice(0, 5),
        reminderRepeatMinutes: row.reminderRepeatMinutes,
        reminderDismissedOn: row.reminderDismissedOn,
        reminderTemplate: row.reminderTemplate,
        patientRefNext: row.patientRefNext,
        requireAge: row.requireAge,
        requireGender: row.requireGender,
        askToEditOnFinish: row.askToEditOnFinish,
        clinicType: row.clinicType,
        requireProvisioning: row.requireProvisioning,
        updatedAt: row.updatedAt,
    };
}

async function readRow(): Promise<SettingsRow> {
    const [existing] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (existing) return existing;

    await db
        .insert(settings)
        .values({ id: 1, clinicName: DEFAULT_CLINIC_NAME, reminderTemplate: DEFAULT_REMINDER_TEMPLATE })
        .onConflictDoNothing();

    const [seeded] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (!seeded) throw AppError.internal('settings row could not be seeded');
    return seeded;
}

/** Every write to the row stamps `updatedAt`. */
async function updateRow(
    values: Partial<typeof settings.$inferInsert>,
    executor: Executor = db,
): Promise<SettingsRow> {
    const [updated] = await executor
        .update(settings)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(settings.id, 1))
        .returning();

    if (!updated) throw AppError.notFound('settings');
    return updated;
}

/** A write, then the handsets are told to refetch. */
async function writeRow(values: Partial<typeof settings.$inferInsert>): Promise<Settings> {
    const updated = await updateRow(values);
    broadcast(WS_EVENT.SETTINGS_UPDATED);
    return toSettings(updated);
}

/**
 * Refuses a next patient number at or below the highest all-digit ref on file:
 * the next registration would be handed a number a patient already has. Old
 * random codes count when they happen to be all digits (`2345`), and so does an
 * old patient's own number, which is their `ref` (§5).
 *
 * At, not merely below: this value is handed out as it stands now, where
 * `patient_ref_last` was handed out plus one.
 */
async function assertPatientRefNext(value: number, executor: Executor): Promise<void> {
    const highest = await highestTakenRef(executor);

    if (value <= highest) {
        throw new AppError(
            ERROR_CODE.PATIENT_REF_BELOW_EXISTING,
            `patientRefNext must be above ${highest}, the highest patient ref in use`,
            422,
        );
    }
}

async function highestTakenRef(executor: Executor): Promise<number> {
    const taken = await executor
        .select({ ref: patients.ref })
        .from(patients)
        .where(sql`${patients.ref} ~ '^[0-9]+$'`);

    return highestNumericRef(taken.map((row) => row.ref));
}

/**
 * The lead time, read under the settings row's own lock, for a caller that is
 * about to write a reminder from it. `update` holds that same lock from its
 * write through `rescheduleAllPending`, so a booking either takes the old lead
 * and commits before the change, or waits and takes the new one. Without it a
 * booking could read the old lead, miss the reschedule because its reminder did
 * not exist yet, and commit the one row the new setting does not reach.
 *
 * Exclusive rather than shared: `nextPatientRef` bumps this row later in the
 * same booking transaction, and two bookings each holding a shared lock and
 * waiting to upgrade it is a deadlock. Bookings already serialize on this row
 * whenever they register a patient.
 */
async function leadHoursForWrite(executor: Executor): Promise<number> {
    const read = () =>
        executor
            .select({ leadHours: settings.reminderLeadHours })
            .from(settings)
            .where(eq(settings.id, 1))
            .for('update')
            .limit(1);

    const [existing] = await read();
    if (existing) return existing.leadHours;

    await executor
        .insert(settings)
        .values({ id: 1, clinicName: DEFAULT_CLINIC_NAME, reminderTemplate: DEFAULT_REMINDER_TEMPLATE })
        .onConflictDoNothing();

    const [seeded] = await read();
    if (!seeded) throw AppError.internal('settings row could not be seeded');
    return seeded.leadHours;
}

interface ClinicDay {
    weekday: number;
    branchId: string;
    opensAt: string;
    closesAt: string;
}

type ClinicDayRow = typeof clinicDays.$inferSelect;

function toClinicDay(row: ClinicDayRow): ClinicDay {
    return {
        weekday: row.weekday,
        branchId: row.branchId,
        opensAt: row.opensAt.slice(0, 5),
        closesAt: row.closesAt.slice(0, 5),
    };
}

export const settingsService = {
    async get(): Promise<Settings> {
        return toSettings(await readRow());
    },

    async ensureSeeded(): Promise<void> {
        await readRow();
    },

    leadHoursForWrite,

    /**
     * Read through the caller's executor, and without seeding: a booking asks
     * from inside its own transaction, which may be the one that seeded the
     * row, and a second connection inserting behind it would wait on that
     * transaction for as long as it waits on this. No row yet is the column
     * defaults.
     */
    async patientRequirements(executor: Executor = db): Promise<PatientRequirements> {
        const [row] = await executor
            .select({ requireAge: settings.requireAge, requireGender: settings.requireGender })
            .from(settings)
            .where(eq(settings.id, 1))
            .limit(1);
        return row ?? { requireAge: DEFAULT_REQUIRE_AGE, requireGender: DEFAULT_REQUIRE_GENDER };
    },

    /** Without seeding, like `patientRequirements`: no row yet is the column default. */
    async clinicType(executor: Executor = db): Promise<ClinicType> {
        const [row] = await executor
            .select({ clinicType: settings.clinicType })
            .from(settings)
            .where(eq(settings.id, 1))
            .limit(1);
        return row?.clinicType ?? 'dental';
    },

    /**
     * `viewer` is the caller's role when a router asks. The clinic's details,
     * numbering and required fields are the admin's to change; durations,
     * reminders and the Finish prompt are everyone's.
     */
    async update(input: UpdateSettingsInput, viewer?: Role | null): Promise<Settings> {
        if (viewer !== undefined && !managesClinic(viewer) && CLINIC_FIELDS.some((field) => field in input)) {
            throw new AppError(
                ERROR_CODE.ROLE_FORBIDDEN,
                'this role may not change how the clinic is set up',
                403,
            );
        }
        const current = await readRow();

        const durationOptions = input.durationOptions
            ? [...new Set(input.durationOptions)].sort((a, b) => a - b)
            : [...current.durationOptions].sort((a, b) => a - b);
        const defaultDuration = input.defaultDuration ?? current.defaultDuration;

        if (!durationOptions.includes(defaultDuration)) {
            throw new AppError(
                ERROR_CODE.INVALID_DURATION,
                'defaultDuration must be one of durationOptions',
                422,
            );
        }

        // Neither the reminders nor the ref counter is in play, so there is
        // nothing the row lock below would protect.
        if (input.reminderLeadHours === undefined && input.patientRefNext === undefined) {
            return writeRow({ ...input, durationOptions, defaultDuration });
        }

        const patientRefNext = input.patientRefNext;
        const updated = await db.transaction(async (tx) => {
            // The row lock comes first, so a registration already numbering
            // itself either commits before the refs are read or waits until
            // this has been written.
            //
            // It is also what the lead time is compared against. `current` was
            // read before this transaction, and two saves racing would both see
            // the old lead: the one writing it back unchanged would decide
            // nothing had changed and skip the reschedule, leaving its own
            // value on the row and the other's on every reminder.
            const [locked] = await tx
                .select({ reminderLeadHours: settings.reminderLeadHours })
                .from(settings)
                .where(eq(settings.id, 1))
                .for('update')
                .limit(1);

            if (patientRefNext !== undefined) await assertPatientRefNext(patientRefNext, tx);

            const row = await updateRow({ ...input, durationOptions, defaultDuration }, tx);

            // "How long before the appointment a reminder becomes due" is a
            // statement about the pending list, not only about the next
            // booking, so a new lead time moves the reminders already on the
            // books — here, under the same lock, so a clinic is never left
            // reading a lead time its pending list does not obey.
            const leadHours = input.reminderLeadHours;
            if (leadHours !== undefined && leadHours !== locked?.reminderLeadHours) {
                await reminderService.rescheduleAllPending(tx, leadHours);
            }

            return row;
        });

        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(updated);
    },

    async schedule(): Promise<ClinicDay[]> {
        const rows = await db.select().from(clinicDays).orderBy(asc(clinicDays.weekday));
        return rows.map(toClinicDay);
    },

    async dayFor(weekday: number): Promise<ClinicDay | null> {
        const [row] = await db.select().from(clinicDays).where(eq(clinicDays.weekday, weekday)).limit(1);
        return row ? toClinicDay(row) : null;
    },

    async setDay(input: SetClinicDayInput): Promise<ClinicDay> {
        await branchService.byId(input.branchId);

        const [row] = await db
            .insert(clinicDays)
            .values(input)
            .onConflictDoUpdate({
                target: clinicDays.weekday,
                set: { branchId: input.branchId, opensAt: input.opensAt, closesAt: input.closesAt },
            })
            .returning();

        if (!row) throw AppError.internal('clinic day upsert returned nothing');

        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toClinicDay(row);
    },

    async clearDay(weekday: number): Promise<void> {
        await db.delete(clinicDays).where(eq(clinicDays.weekday, weekday));
        broadcast(WS_EVENT.SETTINGS_UPDATED);
    },

    /** Read on every request from a phone without a credential, so without seeding: no row is the column default. */
    async requireProvisioning(): Promise<boolean> {
        const [row] = await db
            .select({ requireProvisioning: settings.requireProvisioning })
            .from(settings)
            .where(eq(settings.id, 1))
            .limit(1);
        return row?.requireProvisioning ?? false;
    },

    async setRequireProvisioning(required: boolean): Promise<Settings> {
        await readRow();
        return writeRow({ requireProvisioning: required });
    },

    async dismissRemindersFor(date: string): Promise<Settings> {
        await readRow();
        return writeRow({ reminderDismissedOn: date });
    },

    async resumeRemindersFor(date: string): Promise<Settings> {
        const row = await readRow();
        if (row.reminderDismissedOn !== date) return toSettings(row);
        return writeRow({ reminderDismissedOn: null });
    },
};
