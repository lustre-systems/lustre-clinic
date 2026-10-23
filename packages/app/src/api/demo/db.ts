/**
 * The demo's database: the tables of `server/src/db/schema.ts`, as arrays.
 *
 * Row shapes are the schema's, not the wire's — timestamps are `Date`, money is
 * integer piastres, and `custom` is an object — so the handlers in `./handlers`
 * read like the services they mirror. Turning that into what the wire carries
 * is the link's job, in one place (`./link`), which is also what keeps the ISO
 * strings the screens already parse coming out of demo mode unchanged.
 *
 * Persisted to AsyncStorage so an appointment booked on stage survives a reload
 * (`save`). JSON has no date type, so every timestamp column is named in
 * `revive` rather than sniffed for: a generic "looks like an ISO string"
 * reviver would eventually turn a patient's answer to a date question — which
 * is a `YYYY-MM-DD` string on purpose, not an instant — into a `Date`.
 */

import type {
    AppointmentChannel,
    AppointmentStatus,
    ClinicType,
    LabStatus,
    PaymentMethod,
    QuestionKind,
    ReminderStatus,
    Role,
    Tooth,
    WhatsAppApp,
} from '@lustre/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface BranchRow {
    id: string;
    name: string;
    address: string | null;
    active: boolean;
    whatsappApp: WhatsAppApp;
}

export interface ClinicDayRow {
    weekday: number;
    branchId: string;
    opensAt: string;
    closesAt: string;
}

export interface PatientRow {
    id: string;
    ref: string;
    name: string;
    phone: string;
    email: string | null;
    birthDate: string | null;
    gender: string | null;
    custom: Record<string, unknown>;
    notes: string | null;
    legacyRef: string | null;
    createdAt: Date;
}

export interface ProcedureTypeRow {
    id: string;
    parentId: string | null;
    name: string;
    defaultPrice: number;
    cost: number;
    hasQuantity: boolean;
    isToothSpecific: boolean;
    isCheckup: boolean;
    active: boolean;
    sortOrder: number;
}

export interface AppointmentRow {
    id: string;
    ref: string;
    patientId: string;
    branchId: string;
    startsAt: Date;
    durationMinutes: number;
    note: string | null;
    status: AppointmentStatus;
    channel: AppointmentChannel;
    labStatus: LabStatus | null;
    isOpeningBalance: boolean;
    isImported: boolean;
    dateUnknown: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface AppointmentProcedureRow {
    id: string;
    appointmentId: string;
    procedureId: string;
    quantity: number;
    tooth: Tooth | null;
    note: string | null;
    /** Null unless the desk quoted a price; check-in then bills the catalogue's. */
    quotedPrice: number | null;
    sortOrder: number;
}

export interface VisitRow {
    id: string;
    appointmentId: string;
    checkedInAt: Date;
    inChairAt: Date | null;
    pricedAt: Date | null;
    completedAt: Date | null;
    computedTotal: number;
    chargedTotal: number;
    /** What the patient's next visit is for, in order (`visitNext.ts`). */
    nextProcedures: Array<{ procedureId: string; tooth: Tooth | null }>;
    nextAppointmentId: string | null;
    createdAt: Date;
}

export interface VisitProcedureRow {
    id: string;
    visitId: string;
    procedureId: string;
    quantity: number;
    unitPrice: number;
    unitCost: number;
    tooth: Tooth | null;
    note: string | null;
}

export interface PaymentRow {
    id: string;
    visitId: string;
    amount: number;
    method: PaymentMethod;
    methodNote: string | null;
    paidAt: Date;
}

export interface CustomQuestionRow {
    id: string;
    key: string;
    label: string;
    labelAr: string | null;
    kind: QuestionKind;
    options: unknown;
    required: boolean;
    sortOrder: number;
    active: boolean;
}

export interface ReminderRow {
    id: string;
    appointmentId: string;
    dueAt: Date;
    status: ReminderStatus;
    sentAt: Date | null;
}

/** `server/src/db/schema.ts` — `ref_edits`. Kept when the record it describes is deleted. */
export interface RefEditRow {
    id: string;
    entity: string;
    entityId: string;
    previousRef: string;
    newRef: string;
    editedBy: string;
    editedAt: Date;
}

/**
 * `role_grants`. The server keeps only a hash of the code; the demo keeps the
 * code, because its secrets are nobody's.
 */
export interface RoleGrantRow {
    id: string;
    role: Role;
    label: string;
    code: string;
    issuedBy: string | null;
    issuedAt: Date;
    expiresAt: Date;
    redeemedAt: Date | null;
    revokedAt: Date | null;
}

/** `devices`, with the token for the same reason. */
export interface DeviceRow {
    id: string;
    grantId: string;
    role: Role;
    label: string;
    token: string;
    createdAt: Date;
    revokedAt: Date | null;
}

export interface SettingsRow {
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

export interface DemoDb {
    branches: BranchRow[];
    clinicDays: ClinicDayRow[];
    patients: PatientRow[];
    procedureTypes: ProcedureTypeRow[];
    appointments: AppointmentRow[];
    appointmentProcedures: AppointmentProcedureRow[];
    visits: VisitRow[];
    visitProcedures: VisitProcedureRow[];
    payments: PaymentRow[];
    customQuestions: CustomQuestionRow[];
    reminders: ReminderRow[];
    refEdits: RefEditRow[];
    roleGrants: RoleGrantRow[];
    devices: DeviceRow[];
    settings: SettingsRow;
}

const STORE_KEY = 'lustre.demo.db';

/**
 * Bumped when a row shape changes, or when the seed itself does in a way that
 * makes an already-stored clinic wrong. A stored database from an older build is
 * dropped and reseeded rather than migrated — this is demo data, and half a
 * schema is a worse demo than a fresh one.
 *
 * 2: the week used to be split across both branches, which put today's clinic
 *    day at Zamalek while the day view opens on Maadi — a demo that started on
 *    "Closed on Tuesdays". A phone that already stored that database has to drop
 *    it, or the fix does not reach it.
 * 3: settings carry `patientRefLast`.
 * 4: that column is `patientRefNext` — the number the *next* patient gets, not
 *    the last one handed out — and appointments carry `isImported`.
 * 5: `patientRefNext` seeds at 1001 rather than 1, so an old patient's number
 *    is not refused as one the sequence still owes.
 * 6: `refEdits` — a stored database from 5 has no such array, and every read of
 *    it would be of `undefined`.
 * 7: branches carry `whatsappApp`.
 * 8: appointments carry `labStatus`.
 * 9: settings carry `requireAge` and `requireGender`, and one seeded patient
 *    has no age again.
 * 10: settings carry `askToEditOnFinish`.
 * 11: planned procedures carry `quotedPrice`.
 * 12: `roleGrants` and `devices`, and settings carry `requireProvisioning`.
 * 13: settings carry `clinicType`.
 * 14: visits carry `nextProcedureId`, `nextProcedureTooth` and `nextAppointmentId`
 *     (`nextProcedures` since, upgraded in `revive` rather than versioned).
 * 15: procedures carry `cost`, and visit lines `unitCost`.
 * 16: a year of history at both branches, for the stats screen.
 */
const STORE_VERSION = 16;

let db: DemoDb | null = null;

/**
 * Which clinic `db` is. The handlers are shared, and only the writing differs:
 * the demo's is saved behind the screens, best effort, and local mode's is
 * written before the request answers (`./local`).
 */
export type DbKind = 'demo' | 'local';

let kind: DbKind = 'demo';

/** Local mode's: whether a handler wrote since the last commit. */
let dirty = false;

export function getDb(): DemoDb {
    if (!db) throw new Error('the demo database has not been opened');
    return db;
}

export function setDb(next: DemoDb, as: DbKind = 'demo'): void {
    db = next;
    kind = as;
    dirty = false;
}

export function isOpen(as: DbKind = 'demo'): boolean {
    return db !== null && kind === as;
}

export function openKind(): DbKind | null {
    return db ? kind : null;
}

/** Whether anything was written since the last call, which then starts over. */
export function takeDirty(): boolean {
    const was = dirty;
    dirty = false;
    return was;
}

/**
 * Writes are collapsed: a checkout is several table writes in a row and the
 * screen is waiting on none of them, so the whole database is serialized once
 * the burst is over rather than once per table.
 */
let pending: ReturnType<typeof setTimeout> | null = null;

export function save(): void {
    if (kind === 'local') {
        dirty = true;
        return;
    }
    if (pending) return;
    pending = setTimeout(() => {
        pending = null;
        const current = db;
        if (!current || kind !== 'demo') return;
        void AsyncStorage.setItem(STORE_KEY, JSON.stringify({ version: STORE_VERSION, db: current })).catch(
            () => undefined,
        );
    }, 250);
}

export async function clearStored(): Promise<void> {
    await AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
}

/** Every timestamp column, by table. Anything not named here stays as JSON left it. */
const DATE_FIELDS = {
    patients: ['createdAt'],
    appointments: ['startsAt', 'createdAt', 'updatedAt'],
    visits: ['checkedInAt', 'inChairAt', 'pricedAt', 'completedAt', 'createdAt'],
    payments: ['paidAt'],
    reminders: ['dueAt', 'sentAt'],
    refEdits: ['editedAt'],
    roleGrants: ['issuedAt', 'expiresAt', 'redeemedAt', 'revokedAt'],
    devices: ['createdAt', 'revokedAt'],
} as const satisfies Partial<Record<keyof DemoDb, readonly string[]>>;

function reviveRows(rows: unknown, fields: readonly string[]): void {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        for (const field of fields) {
            const value = record[field];
            if (typeof value === 'string') record[field] = new Date(value);
        }
    }
}

export function revive(parsed: DemoDb): DemoDb {
    for (const [table, fields] of Object.entries(DATE_FIELDS)) {
        reviveRows(parsed[table as keyof DemoDb], fields);
    }
    // A local clinic file from before the next procedures has no such fields, or
    // 1.10's single one, and is upgraded rather than refused (`localFormat.ts`).
    for (const visit of parsed.visits ?? []) {
        const single = visit as VisitRow & {
            nextProcedureId?: string | null;
            nextProcedureTooth?: Tooth | null;
        };
        visit.nextProcedures ??= single.nextProcedureId
            ? [{ procedureId: single.nextProcedureId, tooth: single.nextProcedureTooth ?? null }]
            : [];
        delete single.nextProcedureId;
        delete single.nextProcedureTooth;
        visit.nextAppointmentId ??= null;
    }
    if (typeof parsed.settings?.updatedAt === 'string') {
        parsed.settings.updatedAt = new Date(parsed.settings.updatedAt);
    }
    return parsed;
}

/**
 * A stored database, or nothing. Malformed JSON and an older version both mean
 * "seed a new one" — the caller has a seeder and no use for a partial answer,
 * which is the one case the guide's no-`try` rule makes room for.
 */
export async function loadStored(): Promise<DemoDb | null> {
    const raw = await AsyncStorage.getItem(STORE_KEY).catch(() => null);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as { version?: number; db?: DemoDb };
        if (parsed.version !== STORE_VERSION || !parsed.db) return null;
        return revive(parsed.db);
    } catch {
        return null;
    }
}
