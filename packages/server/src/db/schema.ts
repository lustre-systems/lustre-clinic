/**
 * SPEC §5. Timestamps are `timestamptz`. Money is integer piastres — never
 * floats. IDs are UUIDv7, generated in application code (`Bun.randomUUIDv7()`)
 * because Postgres 17 has no `uuidv7()`.
 *
 * The `EXCLUDE USING gist` overlap constraint on `appointments` and the
 * `btree_gist` extension it needs are not expressible in Drizzle's schema DSL.
 * They live in a hand-written migration; see `db/migrations/`.
 *
 * The weekly schedule keys a row by the weekday itself, so the dentist being
 * in two places on the same day is impossible by construction (MAW-1).
 * `visits.appointment_id` is UNIQUE (one appointment has at most one visit),
 * and `settings` is a single enforced row (id = 1).
 *
 * `patients.legacy_ref` is the number the *old* system knew this patient by. It
 * is free text and not generated here: the old system's format is its own, and
 * the paper files already have that number written on them. For a patient
 * registered as an old patient it is also their `ref` — the desk was given one
 * number for them and must not be shown a second — so the two columns hold the
 * same string and `ref`'s UNIQUE constraint is what refuses the number twice.
 * Nullable and unbackfilled: a patient registered since the cutoff has no old
 * number, and a blank says so.
 *
 * `appointments.is_opening_balance` marks a row that stands for debt carried
 * over from the old system rather than for anything that happened here. A
 * balance is derived per visit and a visit needs an appointment, so a patient
 * who arrived owing 800 gets one of each, dated at the cutoff. The flag is what
 * lets the money and the schedule disagree about them on purpose: they are
 * owed, so `balance.outstanding` counts them, but nothing was billed and nobody
 * sat in the chair, so `balance.summary`, `stats.summary` and the day view
 * leave them out.
 *
 * `appointments.is_imported` is the same trick for work the old system recorded:
 * a row with planned procedures, no visit and therefore no money at all. It
 * belongs in the record's history and nowhere else, so every reader that counts
 * something — the day view, revenue, statistics, reminders, the queue — excludes
 * it the way it already excludes an opening balance. `date_unknown` says the row
 * carries a date only because the column demands one; the record labels it
 * *before migration* rather than reading it out.
 *
 * `appointment_procedures` is the work a booking plans (§7). It mirrors
 * `visit_procedures`, but `quoted_price` is null unless the desk quoted a price:
 * a booking made three weeks out bills at the price on the day, so check-in
 * snapshots the catalogue price for every row without one, seeding one visit
 * line per planned row. Teeth are Palmer notation, null unless
 * the procedure is tooth-specific (§5).
 */
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
        // This clinic's own number for the patient, generated once and written
        // at the top of their page in the paper book (§5). `legacy_ref` below is
        // the *old* system's number and is a different fact: one is ours and
        // always present, the other is theirs and only on patients who predate
        // the migration.
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

export const procedureTypes = pgTable('procedure_types', {
    id: uuid('id').primaryKey(),
    parentId: uuid('parent_id').references((): AnyPgColumn => procedureTypes.id),
    name: text('name').notNull(),
    defaultPrice: integer('default_price').notNull(),
    hasQuantity: boolean('has_quantity').notNull().default(false),
    isToothSpecific: boolean('is_tooth_specific').notNull().default(false),
    isCheckup: boolean('is_checkup').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
});

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
        // `starts_at` is NOT NULL, so a row whose real date nobody knows still
        // carries one. The flag is what stops it being read as that date.
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

export const visits = pgTable(
    'visits',
    {
        id: uuid('id').primaryKey(),
        appointmentId: uuid('appointment_id')
            .notNull()
            .unique()
            .references(() => appointments.id),
        checkedInAt: timestamptz('checked_in_at').notNull(),
        // Arrived and seated are two different moments, and the chair's progress
        // bar is measured from the second one. The desk checks people in as they
        // come through the door and they queue, so `checked_in_at` is when the wait
        // started; `in_chair_at` is when it ended. Null means still waiting.
        inChairAt: timestamptz('in_chair_at'),
        pricedAt: timestamptz('priced_at'),
        completedAt: timestamptz('completed_at'),
        computedTotal: integer('computed_total').notNull().default(0),
        chargedTotal: integer('charged_total').notNull().default(0),
        // What the doctor wants done next time, and the booking that took it: null
        // while the patient's next booking is still to be made (0024).
        nextProcedureId: uuid('next_procedure_id').references(() => procedureTypes.id),
        nextProcedureTooth: text('next_procedure_tooth', { enum: TEETH }),
        nextAppointmentId: uuid('next_appointment_id').references((): AnyPgColumn => appointments.id, {
            onDelete: 'set null',
        }),
        createdAt: timestamptz('created_at').notNull().defaultNow(),
    },
    (t) => [
        check(
            'visits_next_procedure_set',
            sql`${t.nextProcedureId} IS NOT NULL OR (${t.nextProcedureTooth} IS NULL AND ${t.nextAppointmentId} IS NULL)`,
        ),
    ],
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
        // Negative is a refund: a correction to a visit that was checked out
        // recording more than was handed over (`0002_payment_corrections.sql`).
        // Zero is not a correction, it is a mistake.
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
        tooth: text('tooth', { enum: TEETH }),
        note: text('note'),
    },
    (t) => [
        index('visit_procedures_visit_id_idx').on(t.visitId),
        check('visit_procedures_quantity_positive', sql`${t.quantity} > 0`),
    ],
);

// A question is asked in both languages; the answer is stored once, in whichever
// language it was given (§14). `label_ar` is nullable because a clinic that only
// works in one language has no translation to write, and the resolution rule
// falls back to the label that exists.
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
        // The ref the next *new* patient will be given. Read and incremented in
        // the same transaction as the patient insert, so two registrations at
        // once cannot share one. An old patient keeps their own number and
        // never touches this.
        patientRefNext: integer('patient_ref_next').notNull().default(1),
        // Whether a registration needs an age, and a sex. Checked by the
        // patient service, not by a constraint on `patients`: turning one off
        // has to be possible, and turning one on must not break the records
        // already on file without it.
        requireAge: boolean('require_age').notNull().default(DEFAULT_REQUIRE_AGE),
        requireGender: boolean('require_gender').notNull().default(DEFAULT_REQUIRE_GENDER),
        // Whether the doctor's Finish asks first if the procedures need editing.
        askToEditOnFinish: boolean('ask_to_edit_on_finish').notNull().default(true),
        // `general` is a clinic that is not charting teeth. Procedures keep
        // their `is_tooth_specific`, so going back to `dental` restores them.
        clinicType: text('clinic_type', { enum: CLINIC_TYPES }).notNull().default('dental'),
        // Whether a phone with no role credential is refused. Off, so the
        // phones installed before roles existed keep working until each has
        // scanned a code; an admin turns it on once they all have.
        requireProvisioning: boolean('require_provisioning').notNull().default(false),
        updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    },
    (t) => [
        check('settings_single_row', sql`${t.id} = 1`),
        check('settings_clinic_type_valid', sql`${t.clinicType} IN ('dental', 'general')`),
    ],
);

/**
 * Every ref that was changed after the fact: what it was, what it became, the
 * role that declared the change, and when.
 *
 * `entity_id` carries no foreign key, deliberately. An audit trail whose rows
 * vanish with the record they describe is not one — a ref edited onto the wrong
 * patient and the patient then deleted is exactly the sequence somebody comes
 * back asking about. It is a plain uuid for the same reason it is paired with
 * `entity`: appointments carry refs too (§5), and they edit into this table
 * without a second one.
 *
 * `edited_by` is a `CLIENT_ROLES` value and not a user: there are no accounts
 * (§1). It records what the client said it was, which is the most this model
 * has to record, and is why the column is text rather than a reference.
 */
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

/**
 * A role, offered by QR code. `code_hash` is all that is kept of the code: the
 * QR on the admin's screen is the only copy, so a leaked backup hands out no
 * roles. Single-use, and dead after `expires_at` or once revoked.
 *
 * The row is also the audit trail the admin reads back: who issued it (a device,
 * or null for the server's CLI), and — through `devices.grant_id` — which phone
 * it made and when.
 */
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

/**
 * A phone that redeemed a grant. `token_hash` is the hash of the credential it
 * sends on every request; the role on this row is the only role the server
 * believes it has. Revoking the grant revokes this too, and a revoked phone is
 * refused whether or not the clinic requires provisioning.
 */
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
