import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { payments } from '../src/db/schema.ts';
import { balanceService } from '../src/modules/balance/balance.service.ts';
import { patientService } from '../src/modules/patient/patient.service.ts';
import { procedureHistoryService } from '../src/modules/procedure/procedure.history.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { CHECKUP_PRICE, expectAppError, clinic as fixtures, ROOT_CANAL_PRICE } from './helpers/factories.ts';

async function register(phone: string) {
    return patientService.create({ name: 'On File Already', phone, birthDate: '1990-01-01', custom: {} });
}

describe('recording a visit that already happened', () => {
    beforeAll(setupDatabase);
    beforeEach(truncateAll);

    const DAY = '2026-09-10';

    test('lands as a completed visit, paid in cash on the day', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660001');

        const added = await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            offsetMinutes: 0,
            branchId: clinic.branch.id,
            procedures: [{ procedureId: clinic.checkup.id, quantity: 1 }],
        });

        expect(added.chargedTotal).toBe(CHECKUP_PRICE);

        const { history } = await patientService.byId(patient.id);
        expect(history).toHaveLength(1);

        const [row] = history;
        expect(row?.isImported).toBe(false);
        expect(row?.isOpeningBalance).toBe(false);
        expect(row?.visitId).toBe(added.visitId);
        expect(row?.chargedTotal).toBe(CHECKUP_PRICE);
        expect(row?.balance).toBe(0);
        expect(row?.startsAt.toISOString()).toBe(`${DAY}T12:00:00.000Z`);

        const [payment] = await db.select().from(payments).where(eq(payments.visitId, added.visitId));
        expect(payment?.amount).toBe(CHECKUP_PRICE);
        expect(payment?.method).toBe('cash');
        expect(payment?.paidAt.toISOString()).toBe(`${DAY}T12:00:00.000Z`);

        const outstanding = await balanceService.outstanding();
        expect(outstanding.patients.find((p) => p.patientId === patient.id)).toBeUndefined();
    });

    test('owes the visit once the payment is taken back', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660006');

        const added = await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            branchId: clinic.branch.id,
            offsetMinutes: 0,
            procedures: [{ procedureId: clinic.checkup.id, quantity: 1 }],
        });
        const [payment] = await db.select().from(payments).where(eq(payments.visitId, added.visitId));
        if (!payment) throw new Error('no payment written');
        await visitService.deletePayment({ paymentId: payment.id });

        const outstanding = await balanceService.outstanding();
        expect(outstanding.patients.find((p) => p.patientId === patient.id)?.balance).toBe(CHECKUP_PRICE);
    });

    test('writes no payment for a visit charged nothing', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660007');

        const added = await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            branchId: clinic.branch.id,
            offsetMinutes: 0,
            procedures: [{ procedureId: clinic.checkup.id, quantity: 1, unitPrice: 0 }],
        });

        expect(added.chargedTotal).toBe(0);
        expect(await db.select().from(payments).where(eq(payments.visitId, added.visitId))).toHaveLength(0);
    });

    test('charges the price it is given rather than the catalogue’s', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660002');

        const added = await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            offsetMinutes: 0,
            procedures: [{ procedureId: clinic.xray.id, quantity: 2, unitPrice: 5_000 }],
        });

        expect(added.chargedTotal).toBe(10_000);
    });

    test('takes two on the same day without colliding', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660003');

        await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            offsetMinutes: 0,
            branchId: clinic.branch.id,
            procedures: [{ procedureId: clinic.checkup.id, quantity: 1 }],
        });
        await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            offsetMinutes: 0,
            branchId: clinic.branch.id,
            procedures: [{ procedureId: clinic.rootCanal.id, quantity: 1 }],
        });

        const { history } = await patientService.byId(patient.id);
        expect(history).toHaveLength(2);
    });

    test('refuses a day that has not happened', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660005');

        await expectAppError(ERROR_CODE.VALIDATION, () =>
            procedureHistoryService.addOldVisit({
                patientId: patient.id,
                performedOn: '2099-01-01',
                offsetMinutes: 0,
                procedures: [{ procedureId: clinic.checkup.id, quantity: 1 }],
            }),
        );
        expect((await patientService.byId(patient.id)).history).toHaveLength(0);
    });

    test('judges the day by the clinic’s offset', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660010');
        const eastToday = new Date(Date.now() + 840 * 60_000).toISOString().slice(0, 10);
        const line = [{ procedureId: clinic.checkup.id, quantity: 1 }];

        await expectAppError(ERROR_CODE.VALIDATION, () =>
            procedureHistoryService.addOldVisit({
                patientId: patient.id,
                performedOn: eastToday,
                offsetMinutes: -840,
                procedures: line,
            }),
        );
        const added = await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: eastToday,
            offsetMinutes: 840,
            procedures: line,
        });
        expect(added.visitId).toBeTruthy();
    });

    test('waives the checkup when other work was done', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660011');

        const added = await procedureHistoryService.addOldVisit({
            patientId: patient.id,
            performedOn: DAY,
            offsetMinutes: 0,
            procedures: [
                { procedureId: clinic.checkup.id, quantity: 1 },
                { procedureId: clinic.rootCanal.id, quantity: 1 },
            ],
        });

        expect(added.chargedTotal).toBe(ROOT_CANAL_PRICE);
    });

    test('answers NOT_FOUND for a branch that does not exist', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660012');

        await expectAppError(ERROR_CODE.NOT_FOUND, () =>
            procedureHistoryService.addOldVisit({
                patientId: patient.id,
                performedOn: DAY,
                offsetMinutes: 0,
                branchId: Bun.randomUUIDv7(),
                procedures: [{ procedureId: clinic.checkup.id, quantity: 1 }],
            }),
        );
    });

    test('holds the catalogue rules, and writes nothing when one is broken', async () => {
        const clinic = await fixtures();
        const patient = await register('01066660006');

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            procedureHistoryService.addOldVisit({
                patientId: patient.id,
                performedOn: DAY,
                offsetMinutes: 0,
                procedures: [{ procedureId: clinic.extraction.id, quantity: 1 }],
            }),
        );
        expect((await patientService.byId(patient.id)).history).toHaveLength(0);
    });
});
