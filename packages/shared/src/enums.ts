import { z } from 'zod';

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

export const SLOT_HOLDING_STATUSES = ['booked', 'checked_in'] as const satisfies readonly AppointmentStatus[];

export const DAY_FILLING_STATUSES = [
    'booked',
    'checked_in',
    'awaiting_payment',
    'done',
] as const satisfies readonly AppointmentStatus[];

export const APPOINTMENT_CHANNELS = ['desk', 'walk_in'] as const;
export const appointmentChannelSchema = z.enum(APPOINTMENT_CHANNELS);
export type AppointmentChannel = z.infer<typeof appointmentChannelSchema>;

export const LAB_STATUSES = ['pending', 'ready'] as const;
export const labStatusSchema = z.enum(LAB_STATUSES);
export type LabStatus = z.infer<typeof labStatusSchema>;

export const WHATSAPP_APPS = ['business', 'regular'] as const;
export const whatsAppAppSchema = z.enum(WHATSAPP_APPS);
export type WhatsAppApp = z.infer<typeof whatsAppAppSchema>;

export const PAYMENT_METHODS = ['cash', 'visa', 'instapay', 'other'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const QUESTION_KINDS = ['text', 'number', 'boolean', 'select', 'date'] as const;
export const questionKindSchema = z.enum(QUESTION_KINDS);
export type QuestionKind = z.infer<typeof questionKindSchema>;

export const REMINDER_STATUSES = ['pending', 'sent', 'skipped'] as const;
export const reminderStatusSchema = z.enum(REMINDER_STATUSES);
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

// biome-ignore format: one line per quadrant reads as a dental chart
export const PERMANENT_TEETH = [
    'UR1', 'UR2', 'UR3', 'UR4', 'UR5', 'UR6', 'UR7', 'UR8',
    'UL1', 'UL2', 'UL3', 'UL4', 'UL5', 'UL6', 'UL7', 'UL8',
    'LL1', 'LL2', 'LL3', 'LL4', 'LL5', 'LL6', 'LL7', 'LL8',
    'LR1', 'LR2', 'LR3', 'LR4', 'LR5', 'LR6', 'LR7', 'LR8',
] as const;

// biome-ignore format: one line per quadrant reads as a dental chart
export const DECIDUOUS_TEETH = [
    'URA', 'URB', 'URC', 'URD', 'URE',
    'ULA', 'ULB', 'ULC', 'ULD', 'ULE',
    'LLA', 'LLB', 'LLC', 'LLD', 'LLE',
    'LRA', 'LRB', 'LRC', 'LRD', 'LRE',
] as const;

export const TEETH = [...PERMANENT_TEETH, ...DECIDUOUS_TEETH] as const;
export const toothSchema = z.enum(TEETH);
export type Tooth = z.infer<typeof toothSchema>;

export function toothQuadrant(tooth: Tooth): string {
    return tooth.slice(0, 2);
}

export const CLIENT_ROLES = ['secretary', 'doctor'] as const;
export const clientRoleSchema = z.enum(CLIENT_ROLES);
export type ClientRole = z.infer<typeof clientRoleSchema>;

export const ROLES = ['admin', 'doctor', 'secretary'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export function viewOf(role: Role): ClientRole {
    return role === 'secretary' ? 'secretary' : 'doctor';
}

export function seesPayments(role: Role | null): boolean {
    return role !== 'doctor';
}

export function seesStats(role: Role | null): boolean {
    return role === null || role === 'admin';
}

export function managesClinic(role: Role | null): boolean {
    return role === null || role === 'admin';
}

export const LOCALES = ['en', 'ar'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const APPOINTMENT_TRANSITIONS = {
    booked: ['checked_in', 'cancelled', 'no_show'],
    checked_in: ['awaiting_payment', 'done'],
    awaiting_payment: ['done'],
    done: [],
    cancelled: [],
    no_show: [],
} as const satisfies Record<AppointmentStatus, readonly AppointmentStatus[]>;

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
    return (APPOINTMENT_TRANSITIONS[from] as readonly AppointmentStatus[]).includes(to);
}

export const CLINIC_TYPES = ['dental', 'general'] as const;
export const clinicTypeSchema = z.enum(CLINIC_TYPES);
export type ClinicType = z.infer<typeof clinicTypeSchema>;
