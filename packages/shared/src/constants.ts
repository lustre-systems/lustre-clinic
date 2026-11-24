export const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const REF_RANDOM_LENGTH = 4;

export const REF_PATTERN = /^\d{6}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/i;

export const PATIENT_REF_PATTERN = /^(?:[1-9]\d*|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4})$/i;

export const MAX_PATIENT_REF = 2_147_483_647;

export const MAX_OLD_REF_LENGTH = 64;

export const PIASTRES_PER_POUND = 100;

export const MAX_AMOUNT_PIASTRES = 100_000_000;

export const MAX_PROCEDURE_NAME = 160;

export const DEFAULT_DURATION_OPTIONS = [10, 20, 30, 45] as const;
export const DEFAULT_DURATION_MINUTES = 30;
export const DEFAULT_REMINDER_LEAD_HOURS = 24;
export const DEFAULT_REMINDER_NOTIFY_AT = '19:00';
export const DEFAULT_REMINDER_REPEAT_MINUTES = 30;

export const DEFAULT_REQUIRE_AGE = true;
export const DEFAULT_REQUIRE_GENDER = false;

export const DEFAULT_CLINIC_NAME = 'Clinic';

export const DEFAULT_REMINDER_TEMPLATE =
    'Hello {{name}}, this is a reminder of your appointment at {{clinic}} on {{date}} at {{time}}.';

export const REMINDER_PLACEHOLDERS = ['name', 'date', 'time', 'branch', 'clinic', 'ref'] as const;
export type ReminderPlaceholder = (typeof REMINDER_PLACEHOLDERS)[number];

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;

export const WS_EVENT = {
    APPOINTMENT_CREATED: 'appointment:created',
    APPOINTMENT_UPDATED: 'appointment:updated',
    VISIT_UPDATED: 'visit:updated',
    SETTINGS_UPDATED: 'settings:updated',
    PATIENT_UPDATED: 'patient:updated',
    REMINDER_UPDATED: 'reminder:updated',
    CATALOG_UPDATED: 'catalog:updated',
    VISIT_COMPLETED: 'visit:completed',
    APPOINTMENT_CHECKED_IN: 'appointment:checked_in',
    DEVICES_UPDATED: 'devices:updated',
} as const;

export type WsEvent = (typeof WS_EVENT)[keyof typeof WS_EVENT];

export const WS_PROTOCOL_VERSION = 1;

export const WS_RESUME_PARAM = { EPOCH: 'epoch', SINCE: 'since' } as const;

export type WsFrame =
    | { v: number; type: 'event'; epoch: string; seq: number; at: number; event: WsEvent; id?: string }
    | { v: number; type: 'hello'; epoch: string; seq: number; resync: boolean };

export const TRPC_ENDPOINT = '/trpc';
export const WS_PATH = '/ws';

export const WS_CLOSE_REFUSED = 1008;

export const APK_PATH = '/app/android.apk';
export const UPDATES_MANIFEST_PATH = '/updates/manifest';
export const UPDATES_ASSETS_PATH = '/updates/assets';
export const UPDATES_CHANNEL = 'production';
