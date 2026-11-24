export { RequestError } from './client';
export { useGeneralClinic } from './clinicType';
export type { BookedProcedure, PatientRef } from './day';
export { amend, api, arrive, checkInTimes, closeVisit, visitForAppointment } from './day';
export type { QueryResult } from './hooks';
export { useLocalMutation, useLocalQuery } from './hooks';
export type {
    Appointment,
    AppointmentProcedure,
    Branch,
    ClinicDay,
    EmbeddedPatient,
    Patient,
    PendingReminder,
    ProcedureCategory,
    ProcedureRow,
    Visit,
    VisitPayment,
} from './types';
