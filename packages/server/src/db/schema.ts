import {
    APPOINTMENT_CHANNELS,
    APPOINTMENT_STATUSES,
    CLINIC_TYPES,
    DEFAULT_DURATION_MINUTES,
    DEFAULT_DURATION_OPTIONS,
    DEFAULT_REMINDER_LEAD_HOURS,
    DEFAULT_REMINDER_NOTIFY_AT,
    DEFAULT_REMINDER_REPEAT_MINUTES,
    DEFAULT_REQUIRE_AGE,
    DEFAULT_REQUIRE_GENDER,
    LAB_STATUSES,
    PAYMENT_METHODS,
    QUESTION_KINDS,
    REMINDER_STATUSES,
    ROLES,
    TEETH,
    WHATSAPP_APPS,
} from '@lustre/shared';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
    boolean,
    check,
    date,
    index,
    integer,
    jsonb,
    pgTable,
    smallint,
    text,
    time,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const branches = pgTable('branches', {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    address: text('address'),
    active: boolean('active').notNull().default(true),
    whatsappApp: text('whatsapp_app', { enum: WHATSAPP_APPS }).notNull().default('regular'),
});

export const clinicDays = pgTable(
    'clinic_days',
    {
        weekday: smallint('weekday').primaryKey(),
        branchId: uuid('branch_id')
            .notNull()
            .references(() => branches.id),
        opensAt: time('opens_at').notNull(),
        closesAt: time('closes_at').notNull(),
    },
    (t) => [
        check('clinic_days_weekday_range', sql`${t.weekday} BETWEEN 0 AND 6`),
        check('clinic_days_opens_before_closes', sql`${t.opensAt} < ${t.closesAt}`),
    ],
);

export const patients = pgTable(
    'patients',
    {
        id: uuid('id').primaryKey(),
        ref: text('ref').notNull().unique(),
        name: text('name').notNull(),
        phone: text('phone').notNull(),
        email: text('email'),
        birthDate: date('birth_date'),
        gender: text('gender'),
        custom: jsonb('custom').notNull().default(sql`'{}'::jsonb`),
        notes: text('notes'),
        legacyRef: text('legacy_ref'),
        createdAt: timestamptz('created_at').notNull().defaultNow(),
    },
    (t) => [
        index('patients_phone_idx').on(t.phone),
        index('patients_legacy_ref_idx').on(t.legacyRef),
        index('patients_name_idx').using('gin', sql`to_tsvector('simple', ${t.name})`),
    ],
);

export const procedureTypes = pgTable(
    'procedure_types',
    {
        id: uuid('id').primaryKey(),
        parentId: uuid('parent_id').references((): AnyPgColumn => procedureTypes.id),
        name: text('name').notNull(),
        defaultPrice: integer('default_price').notNull(),
        cost: integer('cost').notNull().default(0),
        hasQuantity: boolean('has_quantity').notNull().default(false),
        isToothSpecific: boolean('is_tooth_specific').notNull().default(false),
        isCheckup: boolean('is_checkup').notNull().default(false),
        active: boolean('active').notNull().default(true),
        sortOrder: integer('sort_order').notNull().default(0),
    },
    (t) => [check('procedure_types_cost_non_negative', sql`${t.cost} >= 0`)],
);

export const appointments = pgTable(
    'appointments',
    {
        id: uuid('id').primaryKey(),
        ref: text('ref').notNull().unique(),
        patientId: uuid('patient_id')
            .notNull()
            .references(() => patients.id),
        branchId: uuid('branch_id')
            .notNull()
            .references(() => branches.id),
        startsAt: timestamptz('starts_at').notNull(),
        durationMinutes: integer('duration_minutes').notNull(),
        note: text('note'),
        status: text('status', { enum: APPOINTMENT_STATUSES }).notNull().default('booked'),
        channel: text('channel', { enum: APPOINTMENT_CHANNELS }).notNull().default('desk'),
        labStatus: text('lab_status', { enum: LAB_STATUSES }),
        isOpeningBalance: boolean('is_opening_balance').notNull().default(false),
        isImported: boolean('is_imported').notNull().default(false),
        dateUnknown: boolean('date_unknown').notNull().default(false),
        createdAt: timestamptz('created_at').notNull().defaultNow(),
        updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    },
    (t) => [
        index('appointments_starts_at_idx').on(t.startsAt),
        index('appointments_patient_id_idx').on(t.patientId),
        check('appointments_duration_positive', sql`${t.durationMinutes} > 0`),
        check('appointments_date_unknown_imported', sql`NOT ${t.dateUnknown} OR ${t.isImported}`),
        check('appointments_lab_status_valid', sql`${t.labStatus} IN ('pending', 'ready')`),
    ],
);

export const appointmentProcedures = pgTable(
    'appointment_procedures',
    {
        id: uuid('id').primaryKey(),
        appointmentId: uuid('appointment_id')
            .notNull()
            .references(() => appointments.id, { onDelete: 'cascade' }),
        procedureId: uuid('procedure_id')
            .notNull()
            .references(() => procedureTypes.id),
        quantity: integer('quantity').notNull().default(1),
        tooth: text('tooth', { enum: TEETH }),
        note: text('note'),
        quotedPrice: integer('quoted_price'),
        sortOrder: integer('sort_order').notNull().default(0),
    },
    (t) => [
        index('appointment_procedures_appointment_id_idx').on(t.appointmentId),
        check('appointment_procedures_quantity_positive', sql`${t.quantity} > 0`),
        check('appointment_procedures_quoted_price_non_negative', sql`${t.quotedPrice} >= 0`),
    ],
);

export const visits = pgTable('visits', {
    id: uuid('id').primaryKey(),
    appointmentId: uuid('appointment_id')
        .notNull()
        .unique()
        .references(() => appointments.id),
    checkedInAt: timestamptz('checked_in_at').notNull(),
    inChairAt: timestamptz('in_chair_at'),
    pricedAt: timestamptz('priced_at'),
    completedAt: timestamptz('completed_at'),
    computedTotal: integer('computed_total').notNull().default(0),
    chargedTotal: integer('charged_total').notNull().default(0),
    nextAppointmentId: uuid('next_appointment_id').references((): AnyPgColumn => appointments.id, {
        onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const visitNextProcedures = pgTable(
    'visit_next_procedures',
    {
        id: uuid('id').primaryKey(),
        visitId: uuid('visit_id')
            .notNull()
            .references(() => visits.id, { onDelete: 'cascade' }),
        procedureId: uuid('procedure_id')
            .notNull()
            .references(() => procedureTypes.id),
        tooth: text('tooth', { enum: TEETH }),
        sortOrder: integer('sort_order').notNull().default(0),
    },
    (t) => [index('visit_next_procedures_visit_id_idx').on(t.visitId)],
);

export const payments = pgTable(
    'payments',
    {
        id: uuid('id').primaryKey(),
        visitId: uuid('visit_id')
            .notNull()
            .references(() => visits.id),
        amount: integer('amount').notNull(),
        method: text('method', { enum: PAYMENT_METHODS }).notNull(),
        methodNote: text('method_note'),
        paidAt: timestamptz('paid_at').notNull().defaultNow(),
    },
    (t) => [
        index('payments_visit_id_idx').on(t.visitId),
        check('payments_amount_nonzero', sql`${t.amount} <> 0`),
        check(
            'payments_other_requires_note',
            sql`${t.method} <> 'other' OR (${t.methodNote} IS NOT NULL AND ${t.methodNote} <> '')`,
        ),
    ],
);

export const visitProcedures = pgTable(
    'visit_procedures',
    {
        id: uuid('id').primaryKey(),
        visitId: uuid('visit_id')
            .notNull()
            .references(() => visits.id, { onDelete: 'cascade' }),
        procedureId: uuid('procedure_id')
            .notNull()
            .references(() => procedureTypes.id),
        quantity: integer('quantity').notNull().default(1),
        unitPrice: integer('unit_price').notNull(),
        unitCost: integer('unit_cost').notNull().default(0),
        tooth: text('tooth', { enum: TEETH }),
        note: text('note'),
    },
    (t) => [
        index('visit_procedures_visit_id_idx').on(t.visitId),
        check('visit_procedures_quantity_positive', sql`${t.quantity} > 0`),
        check('visit_procedures_unit_cost_non_negative', sql`${t.unitCost} >= 0`),
    ],
);

export const customQuestions = pgTable('custom_questions', {
    id: uuid('id').primaryKey(),
    key: text('key').notNull().unique(),
    label: text('label').notNull(),
    labelAr: text('label_ar'),
    kind: text('kind', { enum: QUESTION_KINDS }).notNull(),
    options: jsonb('options'),
    required: boolean('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
});

export const reminders = pgTable(
    'reminders',
    {
        id: uuid('id').primaryKey(),
        appointmentId: uuid('appointment_id')
            .notNull()
            .unique()
            .references(() => appointments.id),
        dueAt: timestamptz('due_at').notNull(),
        status: text('status', { enum: REMINDER_STATUSES }).notNull().default('pending'),
        sentAt: timestamptz('sent_at'),
    },
    (t) => [index('reminders_status_due_at_idx').on(t.status, t.dueAt)],
);

export const settings = pgTable(
    'settings',
    {
        id: integer('id').primaryKey().default(1),
        clinicName: text('clinic_name').notNull(),
        clinicPhone: text('clinic_phone'),
        durationOptions: integer('duration_options')
            .array()
            .notNull()
            .default([...DEFAULT_DURATION_OPTIONS]),
        defaultDuration: integer('default_duration').notNull().default(DEFAULT_DURATION_MINUTES),
        reminderLeadHours: integer('reminder_lead_hours').notNull().default(DEFAULT_REMINDER_LEAD_HOURS),
        reminderNotifyAt: time('reminder_notify_at').notNull().default(DEFAULT_REMINDER_NOTIFY_AT),
        reminderRepeatMinutes: integer('reminder_repeat_minutes')
            .notNull()
            .default(DEFAULT_REMINDER_REPEAT_MINUTES),
        reminderDismissedOn: date('reminder_dismissed_on'),
        reminderTemplate: text('reminder_template').notNull(),
        patientRefNext: integer('patient_ref_next').notNull().default(1),
        requireAge: boolean('require_age').notNull().default(DEFAULT_REQUIRE_AGE),
        requireGender: boolean('require_gender').notNull().default(DEFAULT_REQUIRE_GENDER),
        askToEditOnFinish: boolean('ask_to_edit_on_finish').notNull().default(true),
        clinicType: text('clinic_type', { enum: CLINIC_TYPES }).notNull().default('dental'),
        requireProvisioning: boolean('require_provisioning').notNull().default(false),
        updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    },
    (t) => [
        check('settings_single_row', sql`${t.id} = 1`),
        check('settings_clinic_type_valid', sql`${t.clinicType} IN ('dental', 'general')`),
    ],
);

export const refEdits = pgTable(
    'ref_edits',
    {
        id: uuid('id').primaryKey(),
        entity: text('entity').notNull(),
        entityId: uuid('entity_id').notNull(),
        previousRef: text('previous_ref').notNull(),
        newRef: text('new_ref').notNull(),
        editedBy: text('edited_by').notNull(),
        editedAt: timestamptz('edited_at').notNull().defaultNow(),
    },
    (t) => [index('ref_edits_entity_idx').on(t.entity, t.entityId, t.editedAt)],
);

export const roleGrants = pgTable('role_grants', {
    id: uuid('id').primaryKey(),
    role: text('role', { enum: ROLES }).notNull(),
    label: text('label').notNull(),
    codeHash: text('code_hash').notNull().unique(),
    issuedBy: uuid('issued_by'),
    issuedAt: timestamptz('issued_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    redeemedAt: timestamptz('redeemed_at'),
    revokedAt: timestamptz('revoked_at'),
});

export const devices = pgTable('devices', {
    id: uuid('id').primaryKey(),
    grantId: uuid('grant_id')
        .notNull()
        .unique()
        .references(() => roleGrants.id),
    role: text('role', { enum: ROLES }).notNull(),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
});

export const schema = {
    branches,
    clinicDays,
    patients,
    procedureTypes,
    appointments,
    appointmentProcedures,
    visits,
    payments,
    visitProcedures,
    customQuestions,
    reminders,
    refEdits,
    roleGrants,
    devices,
    settings,
};
