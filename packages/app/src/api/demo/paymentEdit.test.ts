/**
 * Editing the money on a visit already checked out, against the demo backend,
 * in the same steps the phone takes: reopen, rewrite the lines as they were,
 * `setPaid` the new total, close again taking nothing. The server's twin is
 * `packages/server/tests/payment-edit.test.ts`; the two must agree, because a
 * demo that settles differently teaches the desk the wrong thing.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.resolve(),
        removeItem: () => Promise.resolve(),
        multiGet: () => Promise.resolve([]),
        multiSet: () => Promise.resolve(),
    },
}));

const { getDb, setDb } = await import('./db');
const { seedDemoDb } = await import('./seed');
const { appointmentHandlers } = await import('./handlers/appointment');
const { visitHandlers } = await import('./handlers/visit');
const { balanceHandlers } = await import('./handlers/balance');
const { patientHandlers } = await import('./handlers/patient');
const { DemoError } = await import('./rules');

beforeEach(() => {
    setDb(seedDemoDb());
});

function checkedOutUnpaid() {
    const db = getDb();
    const branch = db.branches[0];
    const patient = db.patients[3];
    const work = db.procedureTypes.find((row) => row.name === 'Scaling & polishing');
    if (!branch || !patient || !work) throw new Error('the seed is missing its fixtures');

    // Booked clear of the seed's week, then brought to now for the check-in.
    const appointment = appointmentHandlers.create({
        patient: { kind: 'existing', patientId: patient.id },
        branchId: branch.id,
        startsAt: new Date(Date.now() + 9 * 24 * 3_600_000).toISOString(),
        durationMinutes: 30,
        procedures: [{ procedureId: work.id, quantity: 1 }],
        offsetMinutes: 0,
    });
    appointment.startsAt = new Date();

    const owedBefore = outstandingOf(patient.id);
    const visit = visitHandlers.checkIn({ appointmentId: appointment.id });
    const charged = visitHandlers.byId({ id: visit.id }).chargedTotal ?? 0;
    visitHandlers.checkOut({ visitId: visit.id, chargedTotal: charged, paidTotal: 0, method: 'cash' });

    return { visitId: visit.id, patientId: patient.id, charged, owedBefore };
}

function correctPaid(visitId: string, paidTotal: number) {
    const before = visitHandlers.byId({ id: visitId });
    visitHandlers.reopen({ visitId });
    visitHandlers.setProcedures({
        visitId,
        procedures: before.procedures.map((line) => ({
            procedureId: line.procedureId,
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? undefined,
            tooth: line.tooth,
        })),
    });
    const priced = visitHandlers.byId({ id: visitId });
    visitHandlers.setPaid({ visitId, paidTotal, method: 'cash' });
    return visitHandlers.checkOut({
        visitId,
        chargedTotal: priced.chargedTotal ?? 0,
        paidTotal: 0,
        method: 'cash',
    });
}

function outstandingOf(patientId: string): number {
    return balanceHandlers.outstanding({ patientIds: [patientId] }).total;
}

function recordBalance(patientId: string, visitId: string) {
    return patientHandlers.byId({ id: patientId }).history.find((entry) => entry.visitId === visitId)
        ?.balance;
}

describe('editing the payment on a checked-out visit (demo)', () => {
    it('moves unpaid → partial → paid, and the balance follows every step', () => {
        const { visitId, patientId, charged, owedBefore } = checkedOutUnpaid();
        expect(charged).toBeGreaterThan(0);
        expect(outstandingOf(patientId)).toBe(owedBefore + charged);

        const half = Math.round(charged / 2);
        const partial = correctPaid(visitId, half);
        expect(partial.completedAt).toBeInstanceOf(Date);
        expect(partial.chargedTotal).toBe(charged);
        expect(partial.balance).toBe(charged - half);
        expect(outstandingOf(patientId)).toBe(owedBefore + charged - half);
        expect(recordBalance(patientId, visitId)).toBe(charged - half);

        const paid = correctPaid(visitId, charged);
        expect(paid.balance).toBe(0);
        expect(outstandingOf(patientId)).toBe(owedBefore);
        expect(recordBalance(patientId, visitId)).toBe(0);
        expect((paid.payments ?? []).map((p) => p.amount)).toEqual([half, charged - half]);
    });

    it('moves paid in full back down to half, and to nothing', () => {
        const { visitId, patientId, charged, owedBefore } = checkedOutUnpaid();
        correctPaid(visitId, charged);

        const half = Math.round(charged / 2);
        expect(correctPaid(visitId, half).balance).toBe(charged - half);

        const unpaid = correctPaid(visitId, 0);
        expect(unpaid.balance).toBe(charged);
        expect(outstandingOf(patientId)).toBe(owedBefore + charged);
    });

    it('refuses a paid total above the charge, as the server does', () => {
        const { visitId, charged } = checkedOutUnpaid();

        let caught: unknown;
        try {
            visitHandlers.setPaid({ visitId, paidTotal: charged + 100, method: 'cash' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(DemoError);
        expect((caught as InstanceType<typeof DemoError>).code).toBe(ERROR_CODE.PAYMENT_EXCEEDS_BALANCE);
        expect(visitHandlers.byId({ id: visitId }).payments).toEqual([]);
    });

    it('refuses a checkout that takes more than is owed, as the server does', () => {
        const { visitId, charged } = checkedOutUnpaid();
        visitHandlers.reopen({ visitId });

        expect(() =>
            visitHandlers.checkOut({
                visitId,
                chargedTotal: charged,
                paidTotal: charged + 100,
                method: 'cash',
            }),
        ).toThrow(DemoError);
        // Refused before anything moved: still open, still owing all of it.
        const visit = visitHandlers.byId({ id: visitId });
        expect(visit.completedAt).toBeNull();
        expect(visit.balance).toBe(charged);
    });
});
