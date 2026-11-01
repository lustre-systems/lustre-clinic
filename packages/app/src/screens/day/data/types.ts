/**
 * The shapes the day view reads off the wire. Hand-written, which the guide
 * forbids — request and response types should be inferred from `AppRouter` —
 * but the inference cannot reach: `packages/app` does not depend on
 * `packages/server`, and the tRPC client has not landed (BLOCKED.md). What the
 * inference *can* supply — the status, channel and method unions, the tooth
 * enum — is imported from `@lustre/shared` rather than restated. Dates are
 * strings: there is no transformer on the server, so a `timestamptz` arrives
 * as the ISO string JSON made of it. Money is integer piastres everywhere
 * (§9); `visit.balance` is derived, never stored (§10); and a weekday with no
 * `clinic_days` row is a closed day. A reminder row carries the rendered
 * message and a `wa.me` URL, and the user marks it sent or skipped, because
 * delivery cannot be confirmed.
 */
import type {
    AppointmentChannel,
    AppointmentStatus,
    ClinicType,
    LabStatus,
    PaymentMethod,
    Tooth,
    WhatsAppApp,
} from '@lustre/shared';

export interface EmbeddedPatient {
    id: string;
    ref: string;
    name: string;
    phone: string;
}

export interface AppointmentProcedure {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
    tooth: Tooth | null;
    note: string | null;
    /** Null unless the desk quoted a price; check-in then bills the catalogue's. */
    quotedPrice: number | null;
}

export interface Appointment {
    id: string;
    ref: string;
    patientId: string;
    branchId: string;
    startsAt: string;
    durationMinutes: number;
    procedures: AppointmentProcedure[];
    note: string | null;
    status: AppointmentStatus;
    channel: AppointmentChannel;
    /** Null when the visit needs no lab work. */
    labStatus: LabStatus | null;
    createdAt: string;
    updatedAt: string;
    patient: EmbeddedPatient;
}

export type AppointmentRow = Omit<Appointment, 'patient'>;

/** A booked appointment the walk-in pushed out of its way, and where it went. */
export interface MovedAppointment {
    id: string;
    from: string;
    to: string;
}

export interface WalkInResult {
    appointment: AppointmentRow;
    visitId: string;
    /** Empty when the walk-in fitted in a gap and nobody had to move. */
    moved: MovedAppointment[];
}

export interface VisitLine {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
    /** Null with `lineTotal`, and the visit's two totals, on a finished visit a doctor's phone reads. */
    unitPrice: number | null;
    isCheckup: boolean;
    tooth: Tooth | null;
    note: string | null;
    lineTotal: number | null;
}

export interface VisitPayment {
    id: string;
    amount: number;
    method: PaymentMethod;
    methodNote: string | null;
    paidAt: string;
}

export interface Visit {
    id: string;
    appointmentId: string;
    checkedInAt: string;
    /** When they reached the chair. Null while they are still waiting. */
    inChairAt: string | null;
    pricedAt: string | null;
    completedAt: string | null;
    computedTotal: number | null;
    chargedTotal: number | null;
    createdAt: string;
    procedures: VisitLine[];
    /** What the patient's next booking is for, in the doctor's order. */
    nextProcedures: NextProcedure[];
    /** The booking that took them, while it still stands; null while they are owed. */
    nextAppointmentId: string | null;
    /** The three are null on a phone whose role may not see payments (a doctor). */
    payments: VisitPayment[] | null;
    paidTotal: number | null;
    balance: number | null;
}

export interface NextProcedure {
    procedureId: string;
    name: string;
    tooth: Tooth | null;
}

export interface VisitRow {
    id: string;
    appointmentId: string;
    checkedInAt: string;
    inChairAt: string | null;
    computedTotal: number;
    chargedTotal: number;
}

export interface ClinicDay {
    weekday: number;
    branchId: string;
    opensAt: string;
    closesAt: string;
}

export interface Branch {
    id: string;
    name: string;
    address: string | null;
    active: boolean;
    whatsappApp: WhatsAppApp;
}

export interface Patient {
    id: string;
    name: string;
    phone: string;
}

export interface ProcedureType {
    id: string;
    name: string;
    defaultPrice: number;
}

/**
 * `procedure.tree` — one level of nesting (§5): a root is either selectable on
 * its own (Extraction) or a category whose children are the variants that carry
 * the price (Composite filling → Class I/II/III). `isToothSpecific` is what
 * makes the picker ask which tooth before it asks which procedure.
 */
export interface ProcedureRow {
    id: string;
    parentId: string | null;
    name: string;
    defaultPrice: number;
    hasQuantity: boolean;
    isToothSpecific: boolean;
    isCheckup: boolean;
    active: boolean;
    sortOrder: number;
}

export interface ProcedureCategory extends ProcedureRow {
    children: ProcedureRow[];
    /** No children — the root is the procedure, not a heading. */
    selectable: boolean;
}

export interface PendingReminder {
    id: string;
    appointmentId: string;
    dueAt: string;
    startsAt: string;
    ref: string;
    patient: EmbeddedPatient;
    whatsAppUrl: string;
    whatsappApp: WhatsAppApp;
    message: string;
    labStatus: LabStatus | null;
}

export interface ClinicSettings {
    clinicName: string;
    durationOptions: number[];
    defaultDuration: number;
    askToEditOnFinish: boolean;
    clinicType: ClinicType;
}
