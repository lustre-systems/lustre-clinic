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

export interface RefEditRow {
    id: string;
    entity: string;
    entityId: string;
    previousRef: string;
    newRef: string;
    editedBy: string;
    editedAt: Date;
}

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

const STORE_VERSION = 16;

let db: DemoDb | null = null;

export type DbKind = 'demo' | 'local';

let kind: DbKind = 'demo';

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

export function takeDirty(): boolean {
    const was = dirty;
    dirty = false;
    return was;
}

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
