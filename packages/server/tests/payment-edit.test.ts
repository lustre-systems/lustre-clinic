import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { balanceService } from '../src/modules/balance/balance.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import {
    type Clinic,
    expectAppError,
    clinic as fixtures,
    ROOT_CANAL_PRICE,
    todaySlot,
} from './helpers/factories.ts';

/**
 * Editing the money on a visit that was already checked out, the way the
 * phone does it: reopen, rewrite the lines as they were, `setPaid` the new
 * total, and close again taking nothing of its own. The figure the desk reads
 * back is the patient's outstanding, so every step asserts it as well as the
 * visit's own balance.
 */

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

/** A root canal with a checkup on the same visit — the checkup is waived (§9). */
async function checkedOutUnpaid(f: Clinic) {
    const appointment = await appointmentService.create({
        patient: { kind: 'existing', patientId: f.patient.id },
        branchId: f.branch.id,
        startsAt: todaySlot(),
        offsetMinutes: 0,
        procedures: [
            { procedureId: f.checkup.id, quantity: 1 },
            { procedureId: f.rootCanal.id, quantity: 1 },
        ],
    });
    const visit = await visitService.checkIn({ appointmentId: appointment.id });
    const charged = (await visitService.byId(visit.id)).chargedTotal ?? 0;
    await visitService.checkOut({ visitId: visit.id, chargedTotal: charged, paidTotal: 0, method: 'cash' });
    return { visitId: visit.id, charged };
}

async function correctPaid(visitId: string, paidTotal: number) {
    const before = await visitService.byId(visitId);
    await visitService.reopen({ visitId });
    await visitService.setProcedures({
        visitId,
        procedures: before.procedures.map((line) => ({
            procedureId: line.procedureId,
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? undefined,
            tooth: line.tooth,
        })),
    });
    const priced = await visitService.byId(visitId);
    await visitService.setPaid({ visitId, paidTotal, method: 'cash' });
    return visitService.checkOut({
        visitId,
        chargedTotal: priced.chargedTotal ?? 0,
        paidTotal: 0,
        method: 'cash',
    });
}

async function outstandingOf(patientId: string): Promise<number> {
    return (await balanceService.outstanding([patientId])).total;
}

async function recordBalance(patientId: string, visitId: string): Promise<number | null | undefined> {
    const record = await patientService.byId(patientId);
    return record.history.find((entry) => entry.visitId === visitId)?.balance;
}

describe('editing the payment on a checked-out visit', () => {
    test('moves unpaid → partial → paid, and the balance follows every step', async () => {
        const f = await fixtures();
        const { visitId, charged } = await checkedOutUnpaid(f);

        // The checkup is waived beside the root canal, and correcting the money
        // must not bring it back.
        expect(charged).toBe(ROOT_CANAL_PRICE);
        expect(await outstandingOf(f.patient.id)).toBe(charged);

        const half = Math.round(charged / 2);
        const partial = await correctPaid(visitId, half);
        expect(partial.completedAt).not.toBeNull();
        expect(partial.chargedTotal).toBe(charged);
        expect(partial.paidTotal).toBe(half);
        expect(partial.balance).toBe(charged - half);
        expect(await outstandingOf(f.patient.id)).toBe(charged - half);
        expect(await recordBalance(f.patient.id, visitId)).toBe(charged - half);

        const paid = await correctPaid(visitId, charged);
        expect(paid.chargedTotal).toBe(charged);
        expect(paid.paidTotal).toBe(charged);
        expect(paid.balance).toBe(0);
        expect(await outstandingOf(f.patient.id)).toBe(0);
        expect(await recordBalance(f.patient.id, visitId)).toBe(0);

        // Append-only: each correction is a row of its own.
        expect((paid.payments ?? []).map((p) => p.amount)).toEqual([half, charged - half]);
    });

    test('moves paid in full back down to half, and to nothing', async () => {
        const f = await fixtures();
        const { visitId, charged } = await checkedOutUnpaid(f);
        await correctPaid(visitId, charged);

        const half = Math.round(charged / 2);
        const partial = await correctPaid(visitId, half);
        expect(partial.balance).toBe(charged - half);
        expect(await outstandingOf(f.patient.id)).toBe(charged - half);

        const unpaid = await correctPaid(visitId, 0);
        expect(unpaid.paidTotal).toBe(0);
        expect(unpaid.balance).toBe(charged);
        expect(await outstandingOf(f.patient.id)).toBe(charged);
        expect((unpaid.payments ?? []).map((p) => p.amount)).toEqual([charged, half - charged, -half]);
    });

    test('refuses a paid total above the charge, writing nothing', async () => {
        const f = await fixtures();
        const { visitId, charged } = await checkedOutUnpaid(f);

        await expectAppError(ERROR_CODE.PAYMENT_EXCEEDS_BALANCE, () =>
            visitService.setPaid({ visitId, paidTotal: charged + 100, method: 'cash' }),
        );

        const visit = await visitService.byId(visitId);
        expect(visit.payments).toEqual([]);
        expect(visit.balance).toBe(charged);
    });

    test('still lowers a total that sits above a charge which came down after it was paid', async () => {
        const f = await fixtures();
        const { visitId, charged } = await checkedOutUnpaid(f);
        await visitService.setPaid({ visitId, paidTotal: charged, method: 'cash' });

        await visitService.reopen({ visitId });
        await visitService.setPrice({ visitId, chargedTotal: charged - 50_000 });

        const lowered = await visitService.setPaid({ visitId, paidTotal: charged - 20_000, method: 'cash' });
        expect(lowered.paidTotal).toBe(charged - 20_000);

        const refunded = await visitService.setPaid({ visitId, paidTotal: charged - 50_000, method: 'cash' });
        expect(refunded.balance).toBe(0);
    });
});
