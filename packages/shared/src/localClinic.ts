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

/**
 * A clinic kept on one phone (the app's local mode), as it leaves the phone: a
 * gzipped SQLite snapshot with a row per record, each row's JSON under its table.
 * The app writes it to Google Drive; a phone in local mode restores it, and the
 * server's `import-local` command reads one to move a clinic onto a server. Either way
 * it is assembled into the object below and held to `localClinicFileSchema`.
 *
 * The tables are the server's (`server/src/db/schema.ts`) under their Drizzle
 * names, timestamps as ISO instants and money as integer piastres. A row shape
 * that changes gets an upgrade step in the app's `localFormat.ts` rather than
 * a new version, so `LOCAL_CLINIC_VERSION` moves only when an old reader would
 * misread a new file.
 */
export const LOCAL_CLINIC_FORMAT = 'lustre-local';
export const LOCAL_CLINIC_VERSION = 1;

/** The two tables of a snapshot, and of the phone's own store. */
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

/** Far past any clinic, and short of what inflating a hostile file would take from a phone. */
const SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;

/** Gzip's own header and its size trailer, read before anything is inflated. */
export function isAcceptableGzip(bytes: Uint8Array): boolean {
    if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return false;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        bytes.length - 4,
        true,
    );
    return size <= SNAPSHOT_MAX_BYTES;
}

// `guid`, not `uuid`: the phone's ids are v7 by their time bits but do not set the RFC
// variant, and Postgres's `uuid` takes any 8-4-4-4-12 hex.
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

/**
 * The phone's own role grants and devices are in the file too, but only that
 * phone's: a server keeps hashes and issues its own, so they are checked for
 * being there and nothing more.
 */
export const localClinicFileSchema = z.object({
    format: z.literal(LOCAL_CLINIC_FORMAT),
    version: z.literal(LOCAL_CLINIC_VERSION),
    /** When this copy left the phone. Absent on the phone's own file. */
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

/**
 * A snapshot's rows as the object the schema checks. A table with no rows has
 * none to find, so every table starts empty, and missing settings are left for
 * the schema to refuse. Throws on a row in a table this build does not know:
 * the schema would never see it, and the record would vanish on the way in.
 */
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
