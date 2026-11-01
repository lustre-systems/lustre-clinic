import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { visitService } from '../src/modules/visit/visit.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { checkedInVisit, expectAppError, slot } from './helpers/factories.ts';

/**
 * The next procedures (`visit.next.ts`): set on a visit, taken by the patient's
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
            nextProcedures: [{ procedureId: rootCanal.id }],
        });

        const rootCanalNext = { procedureId: rootCanal.id, name: 'Root canal', tooth: null };
        expect(saved.nextProcedures).toEqual([rootCanalNext]);
        expect(saved.nextAppointmentId).toBeNull();
        expect(await visitService.pendingNextProcedures(patient.id)).toEqual([rootCanalNext]);
    });

    test('holds several, in the order given', async () => {
        const { visit, rootCanal, extraction, patient } = await checkedInVisit();

        const saved = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [
                { procedureId: extraction.id, tooth: 'UR6' },
                { procedureId: rootCanal.id },
                { procedureId: extraction.id, tooth: 'UL6' },
            ],
        });

        const expected = [
            { procedureId: extraction.id, tooth: 'UR6' },
            { procedureId: rootCanal.id, tooth: null },
            { procedureId: extraction.id, tooth: 'UL6' },
        ];
        const shape = (rows: Array<{ procedureId: string; tooth: string | null }>) =>
            rows.map(({ procedureId, tooth }) => ({ procedureId, tooth }));
        expect(shape(saved.nextProcedures)).toEqual(expected);
        expect(shape(await visitService.pendingNextProcedures(patient.id))).toEqual(expected);
    });

    test('are checked against the same rules as lines', async () => {
        const { visit, extraction } = await checkedInVisit();

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [],
                nextProcedures: [{ procedureId: extraction.id }],
            }),
        );
        await expectAppError(ERROR_CODE.PROCEDURE_DUPLICATE, () =>
            visitService.setProcedures({
                visitId: visit.id,
                procedures: [],
                nextProcedures: [
                    { procedureId: extraction.id, tooth: 'UR6' },
                    { procedureId: extraction.id, tooth: 'UR6' },
                ],
            }),
        );
    });

    test('left off keeps them, empty clears them', async () => {
        const { visit, extraction, patient } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: extraction.id, tooth: 'UR6' }],
        });

        const kept = await visitService.setProcedures({ visitId: visit.id, procedures: [] });
        expect(kept.nextProcedures.map((line) => line.tooth)).toEqual(['UR6']);

        const cleared = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [],
        });
        expect(cleared.nextProcedures).toEqual([]);
        expect(await visitService.pendingNextProcedures(patient.id)).toEqual([]);
    });
});

describe('the next booking', () => {
    test('a booking made afterwards takes them', async () => {
        const { visit, rootCanal, xray, patient, branch } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: rootCanal.id }, { procedureId: xray.id }],
        });

        const next = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            procedures: [{ procedureId: rootCanal.id, quantity: 1 }],
            offsetMinutes: 0,
        });

        expect(await visitService.pendingNextProcedures(patient.id)).toEqual([]);
        expect((await visitService.byId(visit.id)).nextAppointmentId).toBe(next.id);
    });

    test('a booking already waiting gets the lines added, once', async () => {
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
            nextProcedures: [
                { procedureId: xray.id },
                { procedureId: extraction.id, tooth: 'UR6' as const },
                { procedureId: extraction.id, tooth: 'UL6' as const },
            ],
        };
        const saved = await visitService.setProcedures(input);
        await visitService.setProcedures(input);

        expect(saved.nextAppointmentId).toBe(waiting.id);
        expect(await linesOf(waiting.id)).toEqual([
            { procedureId: xray.id, tooth: null },
            { procedureId: extraction.id, tooth: 'UR6' },
            { procedureId: extraction.id, tooth: 'UL6' },
        ]);
        expect(await linesOf(later.id)).toEqual([]);
        expect(await visitService.pendingNextProcedures(patient.id)).toEqual([]);
    });

    test('are owed again when the booking that took them is cancelled', async () => {
        const { visit, rootCanal, patient, branch } = await checkedInVisit();
        await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: rootCanal.id }],
        });
        const next = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: slot(),
            offsetMinutes: 0,
        });

        expect((await visitService.byId(visit.id)).nextAppointmentId).toBe(next.id);

        await appointmentService.cancel(next.id);

        expect(
            (await visitService.pendingNextProcedures(patient.id)).map((line) => line.procedureId),
        ).toEqual([rootCanal.id]);
        // The visit no longer says a booking has them.
        expect((await visitService.byId(visit.id)).nextAppointmentId).toBeNull();
    });
});

describe('phones on 1.10', () => {
    test('send one, read the first back, and clear with null', async () => {
        const { visit, rootCanal, xray, patient } = await checkedInVisit();

        const one = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: { procedureId: rootCanal.id },
        });
        expect(one.nextProcedures.map((line) => line.procedureId)).toEqual([rootCanal.id]);

        const several = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedures: [{ procedureId: xray.id }, { procedureId: rootCanal.id }],
        });
        expect(several.nextProcedure).toEqual({
            procedureId: xray.id,
            name: 'X-ray',
            tooth: null,
            appointmentId: null,
        });
        expect((await visitService.pendingNext(patient.id))?.procedureId).toBe(xray.id);

        const cleared = await visitService.setProcedures({
            visitId: visit.id,
            procedures: [],
            nextProcedure: null,
        });
        expect(cleared.nextProcedures).toEqual([]);
        expect(await visitService.pendingNext(patient.id)).toBeNull();
    });
});
