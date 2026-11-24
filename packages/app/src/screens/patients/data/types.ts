import type { AppointmentStatus, ClientRole, PaymentMethod, Tooth } from '@lustre/shared';

export type QuestionKind = 'text' | 'number' | 'boolean' | 'select' | 'date';

export interface CustomQuestion {
    id: string;
    key: string;
    label: string;
    labelAr: string | null;
    kind: QuestionKind;
    options: string[] | null;
    required: boolean;
    sortOrder: number;
    active: boolean;
}

export type Answers = Record<string, unknown>;

export type QuestionnaireGapReason = 'unanswered' | 'answer_no_longer_valid';

export interface QuestionnaireGap {
    key: string;
    label: string;
    labelAr: string | null;
    required: boolean;
    reason: QuestionnaireGapReason;
}

export interface Patient {
    id: string;
    ref: string;
    name: string;
    phone: string;
    email: string | null;
    birthDate: string | null;
    gender: string | null;
    custom: Answers;
    notes: string | null;
    legacyRef: string | null;
    createdAt: string;
    age: number | null;
}

export interface HistoryProcedure {
    name: string;
    quantity: number;
    tooth: string | null;
}

export interface PatientHistoryEntry {
    appointmentId: string;
    visitId: string | null;
    ref: string;
    startsAt: string;
    status: AppointmentStatus;
    checkedInAt: string | null;
    completedAt: string | null;
    isOpeningBalance: boolean;
    isImported: boolean;
    dateUnknown: boolean;
    computedTotal: number | null;
    chargedTotal: number | null;
    paidTotal: number | null;
    balance: number | null;
    procedures: HistoryProcedure[];
}

export interface PatientDetail {
    patient: Patient;
    history: PatientHistoryEntry[];
    questionnaireGaps: QuestionnaireGap[];
}

export interface PatientBalance {
    patientId: string;
    balance: number;
}

export interface SettleInput {
    patientId: string;
    amount: number;
    method: PaymentMethod;
    methodNote?: string | null;
}

export interface SettledVisit {
    visitId: string;
    ref: string;
    startsAt: string;
    outstandingBefore: number;
    amount: number;
    outstandingAfter: number;
    settled: boolean;
}

export interface SettleReport {
    patientId: string;
    amount: number;
    method: PaymentMethod;
    outstandingBefore: number;
    outstandingAfter: number;
    visits: SettledVisit[];
}

export interface RecentPatients {
    patients: Patient[];
    total: number;
}

export interface CreatePatientInput {
    name: string;
    phone: string;
    email?: string | null;
    birthDate?: string | null;
    gender?: string | null;
    custom?: Answers;
    notes?: string | null;
    old?: OldPatientInput;
}

export interface OldProcedureInput {
    procedureId: string;
    quantity: number;
    tooth?: Tooth | null;
    performedOn?: string | null;
}

export interface OldPatientInput {
    ref: string;
    openingBalance?: number;
    procedures: OldProcedureInput[];
}

export interface OldVisitLineInput {
    procedureId: string;
    quantity: number;
    tooth?: Tooth | null;
    unitPrice?: number;
}

export interface AddOldVisitInput {
    patientId: string;
    performedOn: string;
    branchId?: string | null;
    procedures: OldVisitLineInput[];
}

export interface AddedOldVisit {
    appointmentId: string;
    visitId: string;
    chargedTotal: number;
}

export interface UpdatePatientInput {
    id: string;
    name?: string;
    phone?: string;
    email?: string | null;
    birthDate?: string | null;
    gender?: string | null;
    custom?: Answers;
    notes?: string | null;
}

export interface UpdatePatientRefInput {
    id: string;
    ref: string;
    editedBy: ClientRole;
}

export interface RefEdit {
    previousRef: string;
    newRef: string;
    editedBy: string;
    editedAt: string;
}
