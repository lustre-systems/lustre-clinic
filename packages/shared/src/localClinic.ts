import { z } from 'zod';
import {
    appointmentChannelSchema,
    appointmentStatusSchema,
    clinicTypeSchema,
    labStatusSchema,
    paymentMethodSchema,
    questionKindSchema,
    reminderStatusSchema,
    toothSchema,
    whatsAppAppSchema,
} from './enums.ts';

export const LOCAL_CLINIC_FORMAT = 'lustre-local';
export const LOCAL_CLINIC_VERSION = 1;

export const LOCAL_CLINIC_TABLES_SQL = `
    CREATE TABLE IF NOT EXISTS clinic_rows (
        seq INTEGER PRIMARY KEY,
        tbl TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        UNIQUE (tbl, id)
    );
    CREATE TABLE IF NOT EXISTS clinic_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
export const LOCAL_CLINIC_ROWS_SQL = 'SELECT tbl, id, json FROM clinic_rows ORDER BY seq';
export const LOCAL_CLINIC_META_SQL = 'SELECT key, value FROM clinic_meta';

const SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;

export function isAcceptableGzip(bytes: Uint8Array): boolean {
    if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return false;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        bytes.length - 4,
        true,
    );
    return size <= SNAPSHOT_MAX_BYTES;
}

const uuid = z.guid();
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const day = z.iso.date();
const clock = z.iso.time();
const piastres = z.number().int();

const branch = z.object({
    id: uuid,
    name: z.string(),
    address: z.string().nullable(),
    active: z.boolean(),
    whatsappApp: whatsAppAppSchema,
});

const clinicDay = z.object({
    weekday: z.number().int().min(0).max(6),
    branchId: uuid,
    opensAt: clock,
    closesAt: clock,
});

const patient = z.object({
    id: uuid,
    ref: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
    birthDate: day.nullable(),
    gender: z.string().nullable(),
    custom: z.record(z.string(), z.unknown()),
    notes: z.string().nullable(),
    legacyRef: z.string().nullable(),
    createdAt: instant,
});

const procedureType = z.object({
    id: uuid,
    parentId: uuid.nullable(),
    name: z.string(),
    defaultPrice: piastres,
    cost: piastres.min(0),
    hasQuantity: z.boolean(),
    isToothSpecific: z.boolean(),
    isCheckup: z.boolean(),
    active: z.boolean(),
    sortOrder: z.number().int(),
});

const appointment = z.object({
    id: uuid,
    ref: z.string(),
    patientId: uuid,
    branchId: uuid,
    startsAt: instant,
    durationMinutes: z.number().int().positive(),
    note: z.string().nullable(),
    status: appointmentStatusSchema,
    channel: appointmentChannelSchema,
    labStatus: labStatusSchema.nullable(),
    isOpeningBalance: z.boolean(),
    isImported: z.boolean(),
    dateUnknown: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
});

const appointmentProcedure = z.object({
    id: uuid,
    appointmentId: uuid,
    procedureId: uuid,
    quantity: z.number().int().positive(),
    tooth: toothSchema.nullable(),
    note: z.string().nullable(),
    quotedPrice: piastres.nullable(),
    sortOrder: z.number().int(),
});

const visit = z.object({
    id: uuid,
    appointmentId: uuid,
    checkedInAt: instant,
    inChairAt: instant.nullable(),
    pricedAt: instant.nullable(),
    completedAt: instant.nullable(),
    computedTotal: piastres,
    chargedTotal: piastres,
    nextProcedures: z.array(z.object({ procedureId: uuid, tooth: toothSchema.nullable() })),
    nextAppointmentId: uuid.nullable(),
    createdAt: instant,
});

const visitProcedure = z.object({
    id: uuid,
    visitId: uuid,
    procedureId: uuid,
    quantity: z.number().int().positive(),
    unitPrice: piastres,
    unitCost: piastres.min(0),
    tooth: toothSchema.nullable(),
    note: z.string().nullable(),
});

const payment = z.object({
    id: uuid,
    visitId: uuid,
    amount: piastres,
    method: paymentMethodSchema,
    methodNote: z.string().nullable(),
    paidAt: instant,
});

const customQuestion = z.object({
    id: uuid,
    key: z.string(),
    label: z.string(),
    labelAr: z.string().nullable(),
    kind: questionKindSchema,
    options: z.unknown(),
    required: z.boolean(),
    sortOrder: z.number().int(),
    active: z.boolean(),
});

const reminder = z.object({
    id: uuid,
    appointmentId: uuid,
    dueAt: instant,
    status: reminderStatusSchema,
    sentAt: instant.nullable(),
});

const refEdit = z.object({
    id: uuid,
    entity: z.string(),
    entityId: uuid,
    previousRef: z.string(),
    newRef: z.string(),
    editedBy: z.string(),
    editedAt: instant,
});

const settings = z.object({
    clinicName: z.string(),
    clinicPhone: z.string().nullable(),
    durationOptions: z.array(z.number().int().positive()),
    defaultDuration: z.number().int().positive(),
    reminderLeadHours: z.number().int(),
    reminderNotifyAt: clock,
    reminderRepeatMinutes: z.number().int(),
    reminderDismissedOn: day.nullable(),
    reminderTemplate: z.string(),
    patientRefNext: z.number().int().positive(),
    requireAge: z.boolean(),
    requireGender: z.boolean(),
    askToEditOnFinish: z.boolean(),
    clinicType: clinicTypeSchema,
    requireProvisioning: z.boolean(),
    updatedAt: instant,
});

export const localClinicFileSchema = z.object({
    format: z.literal(LOCAL_CLINIC_FORMAT),
    version: z.literal(LOCAL_CLINIC_VERSION),
    exportedAt: instant.optional(),
    db: z.object({
        branches: z.array(branch),
        clinicDays: z.array(clinicDay),
        patients: z.array(patient),
        procedureTypes: z.array(procedureType),
        appointments: z.array(appointment),
        appointmentProcedures: z.array(appointmentProcedure),
        visits: z.array(visit),
        visitProcedures: z.array(visitProcedure),
        payments: z.array(payment),
        customQuestions: z.array(customQuestion),
        reminders: z.array(reminder),
        refEdits: z.array(refEdit),
        roleGrants: z.array(z.unknown()),
        devices: z.array(z.unknown()),
        settings,
    }),
});

export type LocalClinicFile = z.infer<typeof localClinicFileSchema>;

export function assembleLocalClinicFile(
    rows: readonly { tbl: string; json: string }[],
    meta: readonly { key: string; value: string }[],
): unknown {
    const db: Record<string, unknown> = {};
    for (const [table, shape] of Object.entries(localClinicFileSchema.shape.db.shape)) {
        if (shape instanceof z.ZodArray) db[table] = [];
    }
    for (const { tbl, json } of rows) {
        const list = db[tbl];
        if (Array.isArray(list)) list.push(JSON.parse(json));
        else if (tbl === 'settings') db.settings = JSON.parse(json);
        else throw new Error('the snapshot has a table this build does not know');
    }
    const value = (key: string) => meta.find((row) => row.key === key)?.value;
    return {
        format: value('format'),
        version: Number(value('version')),
        exportedAt: value('exportedAt'),
        db,
    };
}
