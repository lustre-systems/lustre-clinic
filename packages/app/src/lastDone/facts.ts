export interface KnownAppointment {
    patientId: string;
    startsAt: string;
}

const CAP = 4000;
const DEPTH = 6;

const patients = new Map<string, string>();
const appointments = new Map<string, KnownAppointment>();
const visitAppointment = new Map<string, string>();
const appointmentVisit = new Map<string, string>();

function keep<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key);
    map.set(key, value);
    if (map.size > CAP) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function text(record: Record<string, unknown>, field: string): string | null {
    const value = record[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function learn(record: Record<string, unknown>): void {
    const id = text(record, 'id');
    if (id === null) return;

    const name = text(record, 'name');
    if (name !== null && typeof record.phone === 'string') keep(patients, id, name);

    const patientId = text(record, 'patientId');
    const startsAt = text(record, 'startsAt');
    if (patientId !== null && startsAt !== null) keep(appointments, id, { patientId, startsAt });

    const appointmentId = text(record, 'appointmentId');
    if (appointmentId !== null && 'checkedInAt' in record) {
        keep(visitAppointment, id, appointmentId);
        keep(appointmentVisit, appointmentId, id);
    }
}

export function noteAnswer(value: unknown, depth = 0): void {
    if (depth > DEPTH) return;
    if (Array.isArray(value)) {
        for (const item of value) noteAnswer(item, depth + 1);
        return;
    }
    if (!isRecord(value)) return;
    learn(value);
    for (const child of Object.values(value)) {
        if (typeof child === 'object' && child !== null) noteAnswer(child, depth + 1);
    }
}

export function patientName(id: string): string | null {
    return patients.get(id) ?? null;
}

export function knownAppointment(id: string): KnownAppointment | null {
    return appointments.get(id) ?? null;
}

export function appointmentOfVisit(visitId: string): string | null {
    return visitAppointment.get(visitId) ?? null;
}

export function visitOfAppointment(appointmentId: string): string | null {
    return appointmentVisit.get(appointmentId) ?? null;
}

export function forgetFacts(): void {
    patients.clear();
    appointments.clear();
    visitAppointment.clear();
    appointmentVisit.clear();
}
