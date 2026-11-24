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
    patientRefNext: number;
    requireAge: boolean;
    requireGender: boolean;
    askToEditOnFinish: boolean;
    clinicType: ClinicType;
    requireProvisioning: boolean;
    updatedAt: Date;
}

export interface PatientRequirements {
    requireAge: boolean;
    requireGender: boolean;
}

type SettingsRow = typeof settings.$inferSelect;

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

async function writeRow(values: Partial<typeof settings.$inferInsert>): Promise<Settings> {
    const updated = await updateRow(values);
    broadcast(WS_EVENT.SETTINGS_UPDATED);
    return toSettings(updated);
}

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

    async patientRequirements(executor: Executor = db): Promise<PatientRequirements> {
        const [row] = await executor
            .select({ requireAge: settings.requireAge, requireGender: settings.requireGender })
            .from(settings)
            .where(eq(settings.id, 1))
            .limit(1);
        return row ?? { requireAge: DEFAULT_REQUIRE_AGE, requireGender: DEFAULT_REQUIRE_GENDER };
    },

    async clinicType(executor: Executor = db): Promise<ClinicType> {
        const [row] = await executor
            .select({ clinicType: settings.clinicType })
            .from(settings)
            .where(eq(settings.id, 1))
            .limit(1);
        return row?.clinicType ?? 'dental';
    },

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

        if (input.reminderLeadHours === undefined && input.patientRefNext === undefined) {
            return writeRow({ ...input, durationOptions, defaultDuration });
        }

        const patientRefNext = input.patientRefNext;
        const updated = await db.transaction(async (tx) => {
            const [locked] = await tx
                .select({ reminderLeadHours: settings.reminderLeadHours })
                .from(settings)
                .where(eq(settings.id, 1))
                .for('update')
                .limit(1);

            if (patientRefNext !== undefined) await assertPatientRefNext(patientRefNext, tx);

            const row = await updateRow({ ...input, durationOptions, defaultDuration }, tx);

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
