import { ERROR_CODE, WS_EVENT } from '@lustre/shared';
import type { RouterInput, RouterOutput } from '../../types';
import { type ClinicDayRow, getDb, type SettingsRow, save } from '../db';
import { broadcast } from '../events';
import { assignDefined, DemoError } from '../rules';
import type { Dated } from '../wire';
import { branchHandlers } from './branch';
import { rescheduleAllPendingReminders } from './reminder';

type Settings = Dated<RouterOutput['settings']['get']>;
type ClinicDay = Dated<RouterOutput['settings']['schedule'][number]>;

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

function toClinicDay(row: ClinicDayRow): ClinicDay {
    return {
        weekday: row.weekday,
        branchId: row.branchId,
        opensAt: row.opensAt.slice(0, 5),
        closesAt: row.closesAt.slice(0, 5),
    };
}

export const settingsHandlers = {
    get(): Settings {
        return toSettings(getDb().settings);
    },

    update(input: RouterInput['settings']['update']): Settings {
        const current = getDb().settings;

        const durationOptions = input.durationOptions
            ? [...new Set(input.durationOptions)].sort((a, b) => a - b)
            : [...current.durationOptions].sort((a, b) => a - b);
        const defaultDuration = input.defaultDuration ?? current.defaultDuration;

        if (!durationOptions.includes(defaultDuration)) {
            throw new DemoError(
                ERROR_CODE.INVALID_DURATION,
                'defaultDuration must be one of durationOptions',
                422,
            );
        }

        const leadHours =
            input.reminderLeadHours !== undefined && input.reminderLeadHours !== current.reminderLeadHours
                ? input.reminderLeadHours
                : undefined;

        assignDefined(current, input, { durationOptions, defaultDuration, updatedAt: new Date() });
        if (leadHours !== undefined) rescheduleAllPendingReminders(leadHours);
        save();

        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(current);
    },

    schedule(): ClinicDay[] {
        return [...getDb().clinicDays].sort((a, b) => a.weekday - b.weekday).map(toClinicDay);
    },

    dayFor(weekday: number): ClinicDay | null {
        const row = getDb().clinicDays.find((day) => day.weekday === weekday);
        return row ? toClinicDay(row) : null;
    },

    setDay(input: RouterInput['settings']['setDay']): ClinicDay {
        branchHandlers.byId(input.branchId);

        const db = getDb();
        const existing = db.clinicDays.find((day) => day.weekday === input.weekday);

        const row: ClinicDayRow = existing ?? { ...input };
        if (existing) Object.assign(existing, input);
        else db.clinicDays.push(row);

        save();
        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toClinicDay(row);
    },

    clearDay(input: RouterInput['settings']['clearDay']): void {
        const db = getDb();
        db.clinicDays = db.clinicDays.filter((day) => day.weekday !== input.weekday);

        save();
        broadcast(WS_EVENT.SETTINGS_UPDATED);
    },

    setRequireProvisioning(input: RouterInput['device']['setRequireProvisioning']): Settings {
        const settings = getDb().settings;
        settings.requireProvisioning = input.required;
        settings.updatedAt = new Date();
        save();
        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(settings);
    },

    dismissRemindersFor(date: string): Settings {
        const current = getDb().settings;
        current.reminderDismissedOn = date;
        current.updatedAt = new Date();

        save();
        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(current);
    },

    resumeRemindersFor(date: string): Settings {
        const current = getDb().settings;
        if (current.reminderDismissedOn !== date) return toSettings(current);
        current.reminderDismissedOn = null;
        current.updatedAt = new Date();

        save();
        broadcast(WS_EVENT.SETTINGS_UPDATED);
        return toSettings(current);
    },
};
