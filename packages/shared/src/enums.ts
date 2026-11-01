import { z } from 'zod';

/**
 * Domain enums (SPEC §5). These are the string values stored in Postgres TEXT
 * columns and sent over the wire, so the tuples are the source of truth for
 * both the Drizzle schema and the client.
 */

/**
 * §7. `checked_in` creates the visit; `done` is set at checkout.
 *
 * `awaiting_payment` is optional: the doctor marks it when he is finished and
 * the patient goes to the desk to pay. Checkout still works straight from
 * `checked_in`, which is what a walk-in or a quick checkup does.
 */
export const APPOINTMENT_STATUSES = [
    'booked',
    'checked_in',
    'awaiting_payment',
    'done',
    'cancelled',
    'no_show',
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/**
 * Statuses that hold a slot. Only these participate in the `EXCLUDE USING gist`
 * overlap constraint — cancelled and no-show appointments free their slot, and
 * so does `awaiting_payment`: that patient has left the chair, so the slot is
 * bookable again even though the visit is not settled.
 */
export const SLOT_HOLDING_STATUSES = ['booked', 'checked_in'] as const satisfies readonly AppointmentStatus[];

/**
 * Statuses that took up room on their day, for "how full was this day" rather
 * than "can I book over this slot now".
 *
 * Wider than `SLOT_HOLDING_STATUSES` on purpose. That one is about the overlap
 * constraint, so it drops `awaiting_payment` and `done` — those slots are free
 * to rebook. But a finished visit filled its slot exactly as much as a booked
 * one, and counting only the live two made the calendar's load bar vanish from
 * every past day as soon as its appointments were checked out. Cancelled and
 * no-show rows are the only ones that never took the room.
 */
export const DAY_FILLING_STATUSES = [
    'booked',
    'checked_in',
    'awaiting_payment',
    'done',
] as const satisfies readonly AppointmentStatus[];

/** How the appointment came to exist. A walk-in is booked and checked in at once. */
export const APPOINTMENT_CHANNELS = ['desk', 'walk_in'] as const;
export const appointmentChannelSchema = z.enum(APPOINTMENT_CHANNELS);
export type AppointmentChannel = z.infer<typeof appointmentChannelSchema>;

/**
 * Lab work (a crown, bridge or denture) a visit waits on. Null on the
 * appointment means the visit needs no lab, which is every booking unless the
 * desk says otherwise. `pending` is sent off; `ready` is back at the clinic.
 */
export const LAB_STATUSES = ['pending', 'ready'] as const;
export const labStatusSchema = z.enum(LAB_STATUSES);
export type LabStatus = z.infer<typeof labStatusSchema>;

/**
 * Which WhatsApp app a branch's reminders open in, when a phone has both. There
 * is no "ask each time": `wa.me` is a verified link WhatsApp claims, so Android
 * never shows its chooser for it.
 */
export const WHATSAPP_APPS = ['business', 'regular'] as const;
export const whatsAppAppSchema = z.enum(WHATSAPP_APPS);
export type WhatsAppApp = z.infer<typeof whatsAppAppSchema>;

/** §5. Fixed, not configurable. `other` requires `methodNote`. */
export const PAYMENT_METHODS = ['cash', 'visa', 'instapay', 'other'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * §5. `select` carries an `options` array; the others ignore it.
 *
 * A `date` answer is stored in `patients.custom` as a `YYYY-MM-DD` string —
 * a calendar date, with no time and no timezone. A birthday or a last-x-ray
 * date is the same date wherever it is read.
 */
export const QUESTION_KINDS = ['text', 'number', 'boolean', 'select', 'date'] as const;
export const questionKindSchema = z.enum(QUESTION_KINDS);
export type QuestionKind = z.infer<typeof questionKindSchema>;

/** §11. No automated sending — the user marks a reminder sent or skipped. */
export const REMINDER_STATUSES = ['pending', 'sent', 'skipped'] as const;
export const reminderStatusSchema = z.enum(REMINDER_STATUSES);
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

/**
 * §5. Palmer notation — quadrant then position, e.g. `UL6` is the upper-left
 * first molar. The quadrants read clockwise from the patient's upper right, and
 * each runs 1 (central incisor) outwards to 8 (third molar).
 *
 * Null on a `visit_procedures` line means the procedure is not tooth-specific.
 */
// biome-ignore format: one line per quadrant reads as a dental chart
export const PERMANENT_TEETH = [
    'UR1', 'UR2', 'UR3', 'UR4', 'UR5', 'UR6', 'UR7', 'UR8',
    'UL1', 'UL2', 'UL3', 'UL4', 'UL5', 'UL6', 'UL7', 'UL8',
    'LL1', 'LL2', 'LL3', 'LL4', 'LL5', 'LL6', 'LL7', 'LL8',
    'LR1', 'LR2', 'LR3', 'LR4', 'LR5', 'LR6', 'LR7', 'LR8',
] as const;

/** §5. Primary dentition, lettered A–E in the same quadrant order. */
// biome-ignore format: one line per quadrant reads as a dental chart
export const DECIDUOUS_TEETH = [
    'URA', 'URB', 'URC', 'URD', 'URE',
    'ULA', 'ULB', 'ULC', 'ULD', 'ULE',
    'LLA', 'LLB', 'LLC', 'LLD', 'LLE',
    'LRA', 'LRB', 'LRC', 'LRD', 'LRE',
] as const;

/**
 * Every selectable tooth. The client renders this as a searchable dropdown
 * rather than a free-text field, so the stored value is always one of these.
 */
export const TEETH = [...PERMANENT_TEETH, ...DECIDUOUS_TEETH] as const;
export const toothSchema = z.enum(TEETH);
export type Tooth = z.infer<typeof toothSchema>;

/** `UR` | `UL` | `LL` | `LR` — the dropdown groups by this. */
export function toothQuadrant(tooth: Tooth): string {
    return tooth.slice(0, 2);
}

/**
 * §6. Which of the two views a phone draws: the desk's day or the doctor's.
 * It is not who the phone is — `ROLES` below is — and a phone that has not been
 * provisioned still carries the one it was set to before roles existed.
 */
export const CLIENT_ROLES = ['secretary', 'doctor'] as const;
export const clientRoleSchema = z.enum(CLIENT_ROLES);
export type ClientRole = z.infer<typeof clientRoleSchema>;

/**
 * Who a provisioned phone is. An admin grants one by QR code, the phone that
 * redeems it is given a credential carrying it, and the server reads the role
 * off that credential on every request — never off anything the client says.
 * The admin is the clinic's owner: the doctor's views and everything else, plus
 * issuing and revoking the codes.
 */
export const ROLES = ['admin', 'doctor', 'secretary'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export function viewOf(role: Role): ClientRole {
    return role === 'secretary' ? 'secretary' : 'doctor';
}

/**
 * Payment history and what a patient owes. A doctor still sees prices and can
 * check a patient out.
 *
 * `null` is a phone with no credential, which keeps what it could do before
 * roles existed until the clinic turns `requireProvisioning` on.
 */
export function seesPayments(role: Role | null): boolean {
    return role !== 'doctor';
}

/**
 * The stats screen and what procedures cost the clinic: the owner's figures.
 * The desk takes payments but never sees the margin on them.
 */
export function seesStats(role: Role | null): boolean {
    return role === null || role === 'admin';
}

/**
 * Setting the clinic up: branches, opening hours, procedures and their prices,
 * patient fields, the clinic's details and numbering, and the backups link.
 * The admin's; a phone with no credential keeps what it could do before roles
 * existed, as with `seesPayments`.
 */
export function managesClinic(role: Role | null): boolean {
    return role === null || role === 'admin';
}

/** §14. English is primary; Arabic mirrors the layout. */
export const LOCALES = ['en', 'ar'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Allowed status transitions (§7). Missed appointments are resolved manually,
 * so nothing here happens on a timer.
 */
export const APPOINTMENT_TRANSITIONS = {
    booked: ['checked_in', 'cancelled', 'no_show'],
    // `awaiting_payment` is a stop on the way to `done`, never a required one.
    checked_in: ['awaiting_payment', 'done'],
    awaiting_payment: ['done'],
    done: [],
    cancelled: [],
    no_show: [],
} as const satisfies Record<AppointmentStatus, readonly AppointmentStatus[]>;

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
    return (APPOINTMENT_TRANSITIONS[from] as readonly AppointmentStatus[]).includes(to);
}

/**
 * What kind of clinic this is. `dental` charts teeth: a tooth-specific
 * procedure asks which tooth. `general` never asks, whatever the catalogue
 * says, and each procedure keeps its own flag so switching back restores it.
 */
export const CLINIC_TYPES = ['dental', 'general'] as const;
export const clinicTypeSchema = z.enum(CLINIC_TYPES);
export type ClinicType = z.infer<typeof clinicTypeSchema>;
