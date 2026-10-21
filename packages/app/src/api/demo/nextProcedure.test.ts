/**
 * The next procedure against the demo and local-mode backend. The server's twin
 * is `packages/server/tests/next-procedure.test.ts`; a phone with no server
 * must take it onto the next booking the same way.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.resolve(),
        removeItem: () => Promise.resolve(),
        multiGet: () => Promise.resolve([]),
        multiSet: () => Promise.resolve(),
    },
}));

const { getDb, revive, setDb } = await import('./db');
const { seedDemoDb } = await import('./seed');
const { appointmentHandlers } = await import('./handlers/appointment');
const { visitHandlers } = await import('./handlers/visit');

beforeEach(() => {
    setDb(seedDemoDb());
});

const DAY = 24 * 3_600_000;

let patientId = '';

function fixtures() {
    const db = getDb();
    const branch = db.branches[0];
    const work = db.procedureTypes.find((row) => row.name === 'Scaling & polishing');
    if (!branch || !work) throw new Error('the seed is missing its fixtures');
    return { branch, patient: { id: patientId }, work };
}

function book(daysOut: number) {
    const { branch } = fixtures();
    return appointmentHandlers.create({
        patient: { kind: 'existing', patientId },
        branchId: branch.id,
        startsAt: new Date(Date.now() + daysOut * DAY).toISOString(),
        durationMinutes: 30,
        offsetMinutes: 0,
    });
}

/**
 * A visit checked in now, for a patient new to the seed: the seeded ones
 * already have bookings to come, which would take the procedure first.
 */
function visitToday() {
    const branch = getDb().branches[0];
    if (!branch) throw new Error('the seed has no branch');
    const appointment = appointmentHandlers.create({
        patient: { kind: 'new', name: 'Salma Fathy', phone: '01098765432', birthDate: '1990-01-01' },
        branchId: branch.id,
        startsAt: new Date(Date.now() + 9 * DAY).toISOString(),
        durationMinutes: 30,
        offsetMinutes: 0,
    });
    patientId = appointment.patientId;
    appointment.startsAt = new Date();
    return visitHandlers.checkIn({ appointmentId: appointment.id });
}

describe('the next procedure in local mode', () => {
    it('is owed until the next booking is made, which takes it', () => {
        const visit = visitToday();
        const { patient, work } = fixtures();

        visitHandlers.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: work.id },
        });
        expect(visitHandlers.pendingNext({ patientId: patient.id })?.procedureId).toBe(work.id);

        const next = book(20);

        expect(visitHandlers.pendingNext({ patientId: patient.id })).toBeNull();
        expect(visitHandlers.byId({ id: visit.id }).nextProcedure?.appointmentId).toBe(next.id);
    });

    it('goes onto the earliest booking already waiting', () => {
        const visit = visitToday();
        const { patient, work } = fixtures();
        const waiting = book(20);
        const later = book(30);

        visitHandlers.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: work.id },
        });

        const lines = (id: string) =>
            getDb().appointmentProcedures.filter((line) => line.appointmentId === id);
        expect(lines(waiting.id).map((line) => line.procedureId)).toEqual([work.id]);
        expect(lines(later.id)).toEqual([]);
        expect(visitHandlers.pendingNext({ patientId: patient.id })).toBeNull();
    });

    it('opens a clinic file written before it existed', () => {
        const stored = JSON.parse(JSON.stringify(getDb()));
        for (const visit of stored.visits) {
            delete visit.nextProcedureId;
            delete visit.nextProcedureTooth;
            delete visit.nextAppointmentId;
        }

        const opened = revive(stored);

        expect(opened.visits.every((visit) => visit.nextProcedureId === null)).toBe(true);
    });
});
