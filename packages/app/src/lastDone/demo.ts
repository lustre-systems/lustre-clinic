/**
 * A demo's "Last done" log, so the button has something to show the first time
 * someone opens the Patients tab in it — it only moves for something new, and a
 * fresh demo has done nothing yet.
 *
 * Built from the demo's own rows, so every line names a patient who exists and
 * opens the booking, visit or record it is about. Never used outside the demo.
 */
import type { DemoDb } from '../api/demo/db';
import type { LastDoneEntry } from './entry';

const MINUTE = 60_000;

function iso(value: Date | string): string {
    return typeof value === 'string' ? value : value.toISOString();
}

export function demoEntries(db: DemoDb, now: number): LastDoneEntry[] {
    const nameOf = (patientId: string) => db.patients.find((p) => p.id === patientId)?.name ?? null;
    const appointment = (id: string) => db.appointments.find((a) => a.id === id);
    const entries: LastDoneEntry[] = [];

    const add = (minutesAgo: number, entry: Omit<LastDoneEntry, 'id' | 'at'>) => {
        entries.push({ ...entry, id: `demo-${entries.length}`, at: now - minutesAgo * MINUTE });
    };

    const booked = db.appointments.find((a) => a.status === 'booked' && new Date(a.startsAt).getTime() > now);
    if (booked) {
        add(2, {
            kind: 'book',
            patientId: booked.patientId,
            patientName: nameOf(booked.patientId),
            appointmentId: booked.id,
            visitId: null,
            detail: { type: 'slot', startsAt: iso(booked.startsAt) },
        });
    }

    const treated = db.visits.find((v) => db.visitProcedures.some((line) => line.visitId === v.id));
    const treatedAppointment = treated ? appointment(treated.appointmentId) : undefined;
    if (treated && treatedAppointment) {
        const lines = db.visitProcedures.filter((line) => line.visitId === treated.id);
        const first = lines[0];
        const name = db.procedureTypes.find((p) => p.id === first?.procedureId)?.name;
        add(40, {
            kind: 'procedures',
            patientId: treatedAppointment.patientId,
            patientName: nameOf(treatedAppointment.patientId),
            appointmentId: treatedAppointment.id,
            visitId: treated.id,
            detail: name
                ? { type: 'procedure', name, tooth: first?.tooth ?? null, more: lines.length - 1 }
                : null,
        });
    }

    const payment = db.payments.find((p) => p.amount > 0);
    const paidVisit = payment ? db.visits.find((v) => v.id === payment.visitId) : undefined;
    const paidAppointment = paidVisit ? appointment(paidVisit.appointmentId) : undefined;
    if (payment && paidAppointment) {
        add(2 * 60 + 15, {
            kind: 'payment',
            patientId: paidAppointment.patientId,
            patientName: nameOf(paidAppointment.patientId),
            appointmentId: null,
            visitId: null,
            detail: { type: 'amount', amount: payment.amount },
        });
    }

    const cancelled = db.appointments.find((a) => a.status === 'cancelled') ?? booked;
    if (cancelled) {
        add(24 * 60 - 30, {
            kind: 'cancel',
            patientId: cancelled.patientId,
            patientName: nameOf(cancelled.patientId),
            appointmentId: cancelled.id,
            visitId: null,
            detail: { type: 'slot', startsAt: iso(cancelled.startsAt) },
        });
    }

    const patient = db.patients[0];
    if (patient) {
        add(24 * 60 + 3 * 60, {
            kind: 'addPatient',
            patientId: patient.id,
            patientName: patient.name,
            appointmentId: null,
            visitId: null,
            detail: { type: 'phone', phone: patient.phone },
        });
    }

    return entries;
}
