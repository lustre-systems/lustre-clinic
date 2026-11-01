/**
 * The next procedures against the demo and local-mode backend. The server's twin
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
    const consult = db.procedureTypes.find((row) => row.name === 'Consultation');
    if (!branch || !work || !consult) throw new Error('the seed is missing its fixtures');
    return { branch, patient: { id: patientId }, work, consult };
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

describe('the next procedures in local mode', () => {
    const owed = () => visitHandlers.pendingNextProcedures({ patientId }).map((line) => line.procedureId);

    it('are owed until the next booking is made, which takes them', () => {
        const visit = visitToday();
        const { work, consult } = fixtures();

        visitHandlers.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: work.id }, { procedureId: consult.id }],
        });
        expect(owed()).toEqual([work.id, consult.id]);

        const next = book(20);

        expect(owed()).toEqual([]);
        expect(visitHandlers.byId({ id: visit.id }).nextAppointmentId).toBe(next.id);
    });

    it('go onto the earliest booking already waiting', () => {
        const visit = visitToday();
        const { work, consult } = fixtures();
        const waiting = book(20);
        const later = book(30);

        visitHandlers.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: work.id }, { procedureId: consult.id }],
        });

        const lines = (id: string) =>
            getDb().appointmentProcedures.filter((line) => line.appointmentId === id);
        expect(lines(waiting.id).map((line) => line.procedureId)).toEqual([work.id, consult.id]);
        expect(lines(later.id)).toEqual([]);
        expect(owed()).toEqual([]);
    });

    it('are owed again, and no longer shown as booked, once that booking is cancelled', () => {
        const visit = visitToday();
        const { work } = fixtures();
        visitHandlers.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: work.id }],
        });
        const next = book(20);

        appointmentHandlers.cancel({ id: next.id });

        expect(owed()).toEqual([work.id]);
        expect(visitHandlers.byId({ id: visit.id }).nextAppointmentId).toBeNull();
    });

    it("take 1.10's single next procedure, and clear on null", () => {
        const visit = visitToday();
        const { work } = fixtures();

        visitHandlers.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: work.id },
        });
        expect(owed()).toEqual([work.id]);
        expect(visitHandlers.pendingNext({ patientId })?.procedureId).toBe(work.id);

        visitHandlers.setProcedures({ visitId: visit.id, procedures: [], nextProcedure: null });
        expect(owed()).toEqual([]);
    });

    it('opens a clinic file written before it existed', () => {
        const stored = JSON.parse(JSON.stringify(getDb()));
        for (const visit of stored.visits) {
            delete visit.nextProcedures;
            delete visit.nextAppointmentId;
        }

        const opened = revive(stored);

        expect(opened.visits.every((visit) => visit.nextProcedures.length === 0)).toBe(true);
    });

    it('opens a 1.10 clinic file, carrying its single next procedure over', () => {
        const { work } = fixtures();
        const stored = JSON.parse(JSON.stringify(getDb()));
        for (const visit of stored.visits) {
            delete visit.nextProcedures;
            visit.nextProcedureId = null;
            visit.nextProcedureTooth = null;
        }
        stored.visits[0].nextProcedureId = work.id;
        stored.visits[0].nextProcedureTooth = 'UR6';

        const opened = revive(stored);

        expect(opened.visits[0]?.nextProcedures).toEqual([{ procedureId: work.id, tooth: 'UR6' }]);
        expect(opened.visits[0]).not.toHaveProperty('nextProcedureId');
        expect(opened.visits[1]?.nextProcedures).toEqual([]);
    });
});
