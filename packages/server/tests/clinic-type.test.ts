import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ERROR_CODE } from '@lustre/shared';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { clinic, expectAppError, todaySlot } from './helpers/factories.ts';

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
});

describe('clinicType', () => {
    test('is off for a clinic that has never set it', async () => {
        expect((await settingsService.get()).clinicType).toBe('dental');
    });

    test('books a tooth-specific procedure with no tooth', async () => {
        const { branch, patient, extraction } = await clinic();
        await settingsService.update({ clinicType: 'general' });

        const booked = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: extraction.id, quantity: 1 }],
        });

        expect((await appointmentService.byId(booked.id)).procedures.map((line) => line.tooth)).toEqual([
            null,
        ]);
    });

    test('still keeps a tooth on a line that carries one', async () => {
        const { branch, patient, extraction } = await clinic();
        await settingsService.update({ clinicType: 'general' });

        const booked = await appointmentService.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: todaySlot(),
            offsetMinutes: 0,
            procedures: [{ procedureId: extraction.id, quantity: 1, tooth: 'UL6' }],
        });

        expect((await appointmentService.byId(booked.id)).procedures.map((line) => line.tooth)).toEqual([
            'UL6',
        ]);
    });

    test('back to dental, asks for the tooth again', async () => {
        const { branch, patient, extraction } = await clinic();
        await settingsService.update({ clinicType: 'general' });
        await settingsService.update({ clinicType: 'dental' });

        await expectAppError(ERROR_CODE.TOOTH_REQUIRED, () =>
            appointmentService.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: todaySlot(),
                offsetMinutes: 0,
                procedures: [{ procedureId: extraction.id, quantity: 1 }],
            }),
        );
    });

    test('is the clinic setup, which a secretary may not change', async () => {
        await expectAppError(ERROR_CODE.ROLE_FORBIDDEN, () =>
            settingsService.update({ clinicType: 'general' }, 'secretary'),
        );
    });
});
