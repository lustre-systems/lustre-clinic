import { expect } from 'bun:test';
import type { ErrorCode } from '@lustre/shared';
import { AppError } from '../../src/errors/AppError.ts';
import { appointmentService } from '../../src/modules/appointment/appointment.service.ts';
import { branchService } from '../../src/modules/branch/branch.service.ts';
import { patientService } from '../../src/modules/patient/patient.service.ts';
import { procedureService } from '../../src/modules/procedure/procedure.service.ts';
import { visitService } from '../../src/modules/visit/visit.service.ts';

export const CHECKUP_PRICE = 30_000;
export const ROOT_CANAL_PRICE = 270_000;
const XRAY_PRICE = 5_000;
export const EXTRACTION_PRICE = 80_000;

export interface Clinic {
    branch: Awaited<ReturnType<typeof branchService.create>>;
    checkup: Awaited<ReturnType<typeof procedureService.create>>;
    rootCanal: Awaited<ReturnType<typeof procedureService.create>>;
    xray: Awaited<ReturnType<typeof procedureService.create>>;
    extraction: Awaited<ReturnType<typeof procedureService.create>>;
    patient: Awaited<ReturnType<typeof patientService.create>>;
}

export async function clinic(): Promise<Clinic> {
    const branch = await branchService.create({ name: 'Main' });
    const checkup = await procedureService.create({
        name: 'Checkup',
        defaultPrice: CHECKUP_PRICE,
        hasQuantity: false,
        isToothSpecific: false,
        isCheckup: true,
        sortOrder: 0,
    });
    const rootCanal = await procedureService.create({
        name: 'Root canal',
        defaultPrice: ROOT_CANAL_PRICE,
        hasQuantity: false,
        isToothSpecific: false,
        isCheckup: false,
        sortOrder: 1,
    });
    const xray = await procedureService.create({
        name: 'X-ray',
        defaultPrice: XRAY_PRICE,
        hasQuantity: true,
        isToothSpecific: false,
        isCheckup: false,
        sortOrder: 2,
    });
    const extraction = await procedureService.create({
        name: 'Extraction',
        defaultPrice: EXTRACTION_PRICE,
        hasQuantity: false,
        isToothSpecific: true,
        isCheckup: false,
        sortOrder: 3,
    });
    const patient = await patientService.create({
        name: 'Nadia Hassan',
        phone: '01012345678',
        birthDate: '1990-01-01',
        custom: {},
    });

    return { branch, checkup, rootCanal, xray, extraction, patient };
}

export function slot(offsetMinutes = 0): string {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() + 1);
    at.setUTCHours(9, 0, 0, 0);
    return new Date(at.getTime() + offsetMinutes * 60_000).toISOString();
}

export function todaySlot(offsetMinutes = 0): string {
    const at = new Date();
    at.setUTCHours(0, 30, 0, 0);
    return new Date(at.getTime() + offsetMinutes * 60_000).toISOString();
}

export async function bookedAppointment(startsAt = slot()) {
    const fixtures = await clinic();
    const appointment = await appointmentService.create({
        patient: { kind: 'existing', patientId: fixtures.patient.id },
        branchId: fixtures.branch.id,
        startsAt,
        offsetMinutes: 0,
    });
    return { ...fixtures, appointment };
}

export async function checkedInVisit(startsAt = todaySlot()) {
    const booked = await bookedAppointment(startsAt);
    const visit = await visitService.checkIn({ appointmentId: booked.appointment.id });
    return { ...booked, visit };
}

export async function expectAppError(code: ErrorCode, fn: () => Promise<unknown>): Promise<void> {
    try {
        await fn();
    } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(code);
        return;
    }
    throw new Error(`expected ${code}, but nothing was thrown`);
}
