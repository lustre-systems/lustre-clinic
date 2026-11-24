import {
    callerWallClock,
    clinicDayOf,
    dayRange,
    ERROR_CODE,
    type ErrorCode,
    MAX_AMOUNT_PIASTRES,
    pad2,
    REF_ALPHABET,
    REF_RANDOM_LENGTH,
    type Tooth,
} from '@lustre/shared';
import type { ProcedureTypeRow } from './db';

export class DemoError extends Error {
    readonly code: ErrorCode;
    readonly httpStatus: number;

    constructor(code: ErrorCode, message: string, httpStatus = 400) {
        super(message);
        this.name = 'DemoError';
        this.code = code;
        this.httpStatus = httpStatus;
    }

    static notFound(what: string): DemoError {
        return new DemoError(ERROR_CODE.NOT_FOUND, `${what} not found`, 404);
    }
}

function isBlank(value: string | null | undefined): boolean {
    return value === null || value === undefined || value.trim() === '';
}

type PatientRequirements = { requireAge: boolean; requireGender: boolean };
type RequiredDetails = { birthDate?: string | null; gender?: string | null };

function ageRequired(): DemoError {
    return new DemoError(ERROR_CODE.AGE_REQUIRED, 'this clinic requires an age on every patient', 422);
}

function genderRequired(): DemoError {
    return new DemoError(ERROR_CODE.GENDER_REQUIRED, 'this clinic requires a sex on every patient', 422);
}

export function assertRegistrable(details: RequiredDetails, requires: PatientRequirements): void {
    if (requires.requireAge && isBlank(details.birthDate)) throw ageRequired();
    if (requires.requireGender && isBlank(details.gender)) throw genderRequired();
}

export function assertNotCleared(patch: RequiredDetails, requires: PatientRequirements): void {
    if (requires.requireAge && patch.birthDate !== undefined && isBlank(patch.birthDate)) throw ageRequired();
    if (requires.requireGender && patch.gender !== undefined && isBlank(patch.gender)) throw genderRequired();
}

let lastMs = 0;
let counter = 0;

export function uuidv7(): string {
    const now = Date.now();
    if (now === lastMs) counter += 1;
    else {
        lastMs = now;
        counter = 0;
    }

    const time = now.toString(16).padStart(12, '0');
    const seq = counter.toString(16).padStart(3, '0').slice(-3);
    return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${seq}-${hex(4, 8)}-${hex(12)}`;
}

function hex(length: number, high = 0): string {
    let out = '';
    for (let i = 0; i < length; i += 1) {
        const digit = i === 0 && high ? high + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 16);
        out += digit.toString(16);
    }
    return out;
}

function randomRefSuffix(): string {
    let out = '';
    for (let i = 0; i < REF_RANDOM_LENGTH; i += 1) {
        out += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
    }
    return out;
}

export function buildRef(startsAt: Date, offsetMinutes = 0): string {
    return `${refDatePart(startsAt, offsetMinutes)}-${randomRefSuffix()}`;
}

export function buildPatientRef(): string {
    return randomRefSuffix();
}

function refDatePart(at: Date, offsetMinutes = 0): string {
    const { year, month, day } = callerWallClock(at, offsetMinutes);
    return `${pad2(day)}${pad2(month)}${pad2(year % 100)}`;
}

export { clinicDayOf, dayRange };

export function ageFromBirthDate(birthDate: string | null, on: Date = new Date()): number | null {
    if (!birthDate) return null;

    const born = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return null;

    let age = on.getUTCFullYear() - born.getUTCFullYear();
    const monthDiff = on.getUTCMonth() - born.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < born.getUTCDate())) age -= 1;

    return age < 0 ? null : age;
}

export function assignDefined<T extends object>(target: T, ...patches: Partial<T>[]): T {
    for (const patch of patches) {
        for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined) (target as Record<string, unknown>)[key] = value;
        }
    }
    return target;
}

export function assertAmount(amount: number, what = 'amount'): number {
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT_PIASTRES) {
        throw new DemoError(ERROR_CODE.INVALID_AMOUNT, `${what} is out of range`, 422);
    }
    return amount;
}

export interface PricedLine {
    unitPrice: number;
    quantity: number;
    isCheckup: boolean;
}

export function computeTotal(lines: readonly PricedLine[]): number {
    const hasOther = lines.some((line) => !line.isCheckup);
    const counted = hasOther ? lines.filter((line) => !line.isCheckup) : lines;
    return counted.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

const DEFAULT_COUNTRY_CODE = '20';

export function normalizePhone(raw: string): string {
    const cleaned = raw.trim().replace(/[\s\-().]/g, '');

    let digits: string;
    if (cleaned.startsWith('+')) digits = cleaned.slice(1);
    else if (cleaned.startsWith('00')) digits = cleaned.slice(2);
    else if (cleaned.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + cleaned.slice(1);
    else digits = cleaned;

    if (!/^\d{8,15}$/.test(digits)) {
        throw new DemoError(ERROR_CODE.INVALID_PHONE, 'phone is not a valid E.164 number', 422);
    }
    return `+${digits}`;
}

export function phoneSearchTerm(raw: string): string | null {
    try {
        return normalizePhone(raw);
    } catch {}

    const cleaned = raw.trim().replace(/[\s\-().]/g, '');

    let digits: string;
    if (cleaned.startsWith('+')) digits = cleaned.slice(1);
    else if (cleaned.startsWith('00')) digits = cleaned.slice(2);
    else if (cleaned.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + cleaned.slice(1);
    else digits = cleaned;

    return /^\d+$/.test(digits) ? digits : null;
}

export function toWhatsAppNumber(e164: string): string {
    return e164.replace(/^\+/, '');
}

export interface RequestedLine {
    procedureId: string;
    quantity: number;
    tooth?: Tooth | null;
    note?: string | null;
}

export interface ResolvedLine {
    procedure: ProcedureTypeRow;
    quantity: number;
    tooth: Tooth | null;
    note: string | null;
}

export function resolveProcedureLines(
    lines: readonly RequestedLine[],
    catalogue: readonly ProcedureTypeRow[],
    general = false,
): ResolvedLine[] {
    const parents = new Set(catalogue.map((row) => row.parentId).filter((id): id is string => id !== null));
    const seen = new Set<string>();

    return lines.map((line) => {
        const procedure = catalogue.find((row) => row.id === line.procedureId);
        if (!procedure) throw DemoError.notFound('procedure');

        if (parents.has(procedure.id)) {
            throw new DemoError(ERROR_CODE.PROCEDURE_NOT_SELECTABLE, 'that procedure is a category', 422);
        }

        const tooth = line.tooth ?? null;

        if (procedure.isToothSpecific && !tooth && !general) {
            throw new DemoError(
                ERROR_CODE.TOOTH_REQUIRED,
                'that procedure must name the tooth it was done on',
                422,
            );
        }
        if (!procedure.isToothSpecific && tooth) {
            throw new DemoError(
                ERROR_CODE.TOOTH_NOT_APPLICABLE,
                'that procedure is not done on a specific tooth',
                422,
            );
        }

        if (!procedure.hasQuantity) {
            const key = `${procedure.id}:${tooth ?? ''}`;
            if (seen.has(key)) {
                throw new DemoError(
                    ERROR_CODE.PROCEDURE_DUPLICATE,
                    tooth
                        ? 'that procedure may appear only once per tooth'
                        : 'that procedure may appear only once',
                    422,
                );
            }
            seen.add(key);
            if (line.quantity !== 1) {
                throw new DemoError(ERROR_CODE.VALIDATION, 'that procedure does not take a quantity', 422);
            }
        }

        return { procedure, quantity: line.quantity, tooth, note: line.note ?? null };
    });
}
