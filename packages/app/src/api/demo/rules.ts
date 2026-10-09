/**
 * The parts of the server the handlers share: its error type, its id and ref
 * generators, and the four rule helpers that live in `server/src/util` and
 * `procedure.rules.ts`.
 *
 * These are ports, not re-exports — `packages/app` depends on `@lustre/server`
 * for types only, and everything on the other side reaches for `Bun`, `crypto`
 * or Postgres. Where a rule is duplicated here the original is named above it,
 * because the two have to be changed together.
 */
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

/** `server/src/errors/AppError.ts`. The link turns this into the wire's `appCode`. */
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

/** A sex typed as spaces is not one. */
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

/** `assertRegistrable` in `server/src/modules/patient/patient.service.ts`. */
export function assertRegistrable(details: RequiredDetails, requires: PatientRequirements): void {
    if (requires.requireAge && isBlank(details.birthDate)) throw ageRequired();
    if (requires.requireGender && isBlank(details.gender)) throw genderRequired();
}

/** `assertNotCleared` in the same file. A field the patch leaves out is not judged. */
export function assertNotCleared(patch: RequiredDetails, requires: PatientRequirements): void {
    if (requires.requireAge && patch.birthDate !== undefined && isBlank(patch.birthDate)) throw ageRequired();
    if (requires.requireGender && patch.gender !== undefined && isBlank(patch.gender)) throw genderRequired();
}

/**
 * `Bun.randomUUIDv7()` on the server. Hermes has neither that nor
 * `crypto.randomUUID`, and the property that matters here is the one v7 is
 * picked for everywhere else in this codebase: ids sort by creation time, which
 * several reads lean on for a stable order.
 */
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

// --- refs (`server/src/util/ref.ts`) ----------------------------------------

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

// --- time (`server/src/util/time.ts`) ---------------------------------------

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

/**
 * `Object.assign` for a patch that may carry explicit `undefined`.
 *
 * The real server is reached over HTTP, and `JSON.stringify` drops a key whose
 * value is `undefined` — so a field the caller left undefined arrives absent
 * and the stored value survives. The demo link hands `op.input` to the handler
 * by reference, with no serialization in between, so the same key arrives
 * present and `Object.assign` writes `undefined` over the column. Skipping the
 * undefined keys is what makes the two agree.
 */
export function assignDefined<T extends object>(target: T, ...patches: Partial<T>[]): T {
    for (const patch of patches) {
        for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined) (target as Record<string, unknown>)[key] = value;
        }
    }
    return target;
}

// --- money (`server/src/util/money.ts`) -------------------------------------

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

/** Σ(unit × quantity), with the checkup line waived whenever other work was done. */
export function computeTotal(lines: readonly PricedLine[]): number {
    const hasOther = lines.some((line) => !line.isCheckup);
    const counted = hasOther ? lines.filter((line) => !line.isCheckup) : lines;
    return counted.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

// --- phone (`server/src/util/phone.ts`) -------------------------------------

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

/**
 * `server/src/util/phone.ts` — what a *search* term is matched against, or null
 * when it holds no number. A half-typed number does not normalize, and matched
 * as typed it would find nothing: the local `0` became `20` on write.
 */
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

// --- procedure lines (`server/src/modules/procedure/procedure.rules.ts`) ----

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

/**
 * Only a leaf may go on a list, `isToothSpecific` decides whether a tooth
 * belongs on the line at all, and uniqueness is per tooth — an extraction on
 * UL6 and one on UR3 are two real lines, while tooth-less lines share one key.
 * A general (not dental) clinic is never asked for a tooth.
 */
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
