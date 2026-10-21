import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { checkedInVisit, expectAppError, slot } from './helpers/factories.ts';

/**
 * The next procedure (`visit.next.ts`): set on a visit, taken by the patient's
 * next booking — the one made after it, or the earliest one already waiting.
 */

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

async function linesOf(appointmentId: string) {
    const appointment = await appointmentService.byId(appointmentId);
    return appointment.procedures.map((line) => ({ procedureId: line.procedureId, tooth: line.tooth }));
}

describe('setting it on a visit', () => {
    test('reads back on the visit and is owed until a booking takes it', async () => {
        const { visit, rootCanal, patient } = await checkedInVisit();

        const saved = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: rootCanal.id },
        });

        expect(saved.nextProcedure).toEqual({
            procedureId: rootCanal.id,
            name: 'Root canal',
            tooth: null,
            appointmentId: null,
        });
        expect(await visitService.pendingNext(patient.id)).toEqual({
            procedureId: rootCanal.id,
            name: 'Root canal',
            tooth: null,
        });
    });

    test('is checked against the same rules as a line', async () => {
        const { visit, extraction } = await checkedInVisit();

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [],
                nextProcedure: { procedureId: extraction.id },
            }),
        );
    });

    test('left off keeps it, null clears it', async () => {
        const { visit, extraction, patient } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: extraction.id, tooth: 'UR6' },
        });

        const kept = await visitService.setProcedures({ visitId: visit.id, procedures: [] });
        expect(kept.nextProcedure?.tooth).toBe('UR6');

        const cleared = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: null,
        });
        expect(cleared.nextProcedure).toBeNull();
        expect(await visitService.pendingNext(patient.id)).toBeNull();
    });
});

describe('the next booking', () => {
    test('a booking made afterwards takes it', async () => {
        const { visit, rootCanal, patient, branch } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: rootCanal.id },
        });

        const next = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
            offsetMinutes: 0,
        });

        expect(await visitService.pendingNext(patient.id)).toBeNull();
        expect((await visitService.byId(visit.id)).nextProcedure?.appointmentId).toBe(next.id);
    });

    test('a booking already waiting gets the line added, once', async () => {
        const { visit, extraction, xray, patient, branch } = await checkedInVisit();
        const waiting = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            procedures: [{ procedureId: xray.id, quantity: 1 }],
            offsetMinutes: 0,
        });
        const later = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(24 * 60),
            offsetMinutes: 0,
        });

        const input = {
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: extraction.id, tooth: 'UR6' as const },
        };
        const saved = await visitService.setProcedures(input);
        await visitService.setProcedures(input);

        expect(saved.nextProcedure?.appointmentId).toBe(waiting.id);
        expect(await linesOf(waiting.id)).toEqual([
            { procedureId: xray.id, tooth: null },
            { procedureId: extraction.id, tooth: 'UR6' },
        ]);
        expect(await linesOf(later.id)).toEqual([]);
        expect(await visitService.pendingNext(patient.id)).toBeNull();
    });

    test('is owed again when the booking that took it is cancelled', async () => {
        const { visit, rootCanal, patient, branch } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: rootCanal.id },
        });
        const next = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });

        await appointmentService.cancel(next.id);

        expect((await visitService.pendingNext(patient.id))?.procedureId).toBe(rootCanal.id);
    });
});
