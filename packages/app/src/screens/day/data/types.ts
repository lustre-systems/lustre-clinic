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
    labStatus: LabStatus | null;
    createdAt: string;
    updatedAt: string;
    patient: EmbeddedPatient;
}

export type AppointmentRow = Omit<Appointment, 'patient'>;

export interface MovedAppointment {
    id: string;
    from: string;
    to: string;
}

export interface WalkInResult {
    appointment: AppointmentRow;
    visitId: string;
    moved: MovedAppointment[];
}

export interface VisitLine {
    id: string;
    procedureId: string;
    name: string;
    quantity: number;
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
    inChairAt: string | null;
    pricedAt: string | null;
    completedAt: string | null;
    computedTotal: number | null;
    chargedTotal: number | null;
    createdAt: string;
    procedures: VisitLine[];
    nextProcedures: NextProcedure[];
    nextAppointmentId: string | null;
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
