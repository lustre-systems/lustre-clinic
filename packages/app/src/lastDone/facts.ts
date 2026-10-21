/**
 * Who an id belongs to, learnt from what the server has already answered.
 *
 * Most writes answer with ids and nothing a person would recognise: a check-in
 * comes back as a visit row, a payment correction as a visit. The log line
 * wants the patient's name, and the screen that made the write had it — it
 * read it a moment earlier, through the same client. So every answer that
 * passes through the log's link is walked for the three shapes that carry it,
 * and kept here: a patient (`id`, `name`, `phone`), an appointment (`id`,
 * `patientId`, `startsAt`, sometimes the patient embedded) and a visit (`id`,
 * `appointmentId`, `checkedInAt`).
 *
 * Memory only, and dropped with everything else on a data reset. It is never
 * written down: the log keeps the one name per line it needs, and nothing more.
 */

export interface KnownAppointment {
    patientId: string;
    startsAt: string;
}

/** Enough for a busy clinic's month of reads, small enough not to matter. */
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

/** Walks an answer for the shapes above. Never throws: it runs inside every request. */
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
