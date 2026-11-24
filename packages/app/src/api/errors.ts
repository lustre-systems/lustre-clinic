import { ERROR_CODE, type ErrorCode, isErrorCode } from '@lustre/shared';
import { TRPCClientError } from '@trpc/client';
import { ServerUnreachableError } from './connection';

export type FailureKind =
    | 'offline'
    | 'timeout'
    | 'server'
    | 'constraint'
    | 'validation'
    | 'notFound'
    | 'unknown';

export interface ApiFailure {
    kind: FailureKind;
    code: ErrorCode;
    httpStatus: number | null;
    retryable: boolean;
    reportable: boolean;
}

const CONSTRAINT_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
    ERROR_CODE.SLOT_OVERLAP,
    ERROR_CODE.INVALID_STATUS_TRANSITION,
    ERROR_CODE.INVALID_DURATION,
    ERROR_CODE.REF_GENERATION_FAILED,
    ERROR_CODE.VISIT_ALREADY_EXISTS,
    ERROR_CODE.CHECK_IN_NOT_TODAY,
    ERROR_CODE.VISIT_ALREADY_COMPLETED,
    ERROR_CODE.VISIT_HAS_NO_PROCEDURES,
    ERROR_CODE.PROCEDURE_NOT_SELECTABLE,
    ERROR_CODE.PROCEDURE_DUPLICATE,
    ERROR_CODE.PROCEDURE_NESTING_TOO_DEEP,
    ERROR_CODE.TOOTH_REQUIRED,
    ERROR_CODE.TOOTH_NOT_APPLICABLE,
    ERROR_CODE.PAYMENT_NOTE_REQUIRED,
    ERROR_CODE.CUSTOM_QUESTION_REQUIRED,
    ERROR_CODE.AGE_REQUIRED,
    ERROR_CODE.GENDER_REQUIRED,
    ERROR_CODE.DUPLICATE_KEY,
    ERROR_CODE.PATIENT_REF_BELOW_EXISTING,
    ERROR_CODE.PATIENT_REF_TAKEN,
    ERROR_CODE.PATIENT_REF_RESERVED,
    ERROR_CODE.MIGRATION_NOT_CONFIGURED,
    ERROR_CODE.IMPORTED_DATE_AFTER_CUTOFF,
    ERROR_CODE.DEVICE_NOT_PROVISIONED,
    ERROR_CODE.DEVICE_REVOKED,
    ERROR_CODE.ROLE_FORBIDDEN,
    ERROR_CODE.GRANT_INVALID,
    ERROR_CODE.GRANT_EXPIRED,
    ERROR_CODE.GRANT_USED,
    ERROR_CODE.GRANT_REVOKED,
    ERROR_CODE.LAST_ADMIN,
]);

const VALIDATION_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
    ERROR_CODE.VALIDATION,
    ERROR_CODE.INVALID_PHONE,
    ERROR_CODE.INVALID_AMOUNT,
    ERROR_CODE.PATIENT_REF_INVALID,
]);

interface TrpcErrorData {
    appCode?: unknown;
    httpStatus?: unknown;
}

function dataOf(error: TRPCClientError<never>): TrpcErrorData {
    return (error.data ?? {}) as TrpcErrorData;
}

function offline(): ApiFailure {
    return {
        kind: 'offline',
        code: ERROR_CODE.INTERNAL,
        httpStatus: null,
        retryable: true,
        reportable: false,
    };
}

export function classifyError(error: unknown): ApiFailure {
    if (error instanceof ServerUnreachableError) return offline();

    if (error instanceof TRPCClientError) {
        const data = dataOf(error);
        const httpStatus = typeof data.httpStatus === 'number' ? data.httpStatus : null;

        if (httpStatus === null && !isErrorCode(data.appCode)) {
            const cause = error.cause;
            if (cause instanceof ServerUnreachableError) return offline();
            const aborted = cause instanceof Error && cause.name === 'AbortError';
            return aborted
                ? {
                      kind: 'timeout',
                      code: ERROR_CODE.INTERNAL,
                      httpStatus: null,
                      retryable: true,
                      reportable: false,
                  }
                : offline();
        }

        const code = isErrorCode(data.appCode) ? data.appCode : ERROR_CODE.INTERNAL;

        if (code === ERROR_CODE.NOT_FOUND) {
            return { kind: 'notFound', code, httpStatus, retryable: false, reportable: false };
        }
        if (VALIDATION_CODES.has(code)) {
            return { kind: 'validation', code, httpStatus, retryable: false, reportable: false };
        }
        if (CONSTRAINT_CODES.has(code)) {
            return { kind: 'constraint', code, httpStatus, retryable: false, reportable: false };
        }
        return { kind: 'server', code, httpStatus, retryable: true, reportable: true };
    }

    if (error instanceof Error && error.name === 'AbortError') {
        return {
            kind: 'timeout',
            code: ERROR_CODE.INTERNAL,
            httpStatus: null,
            retryable: true,
            reportable: false,
        };
    }

    return {
        kind: 'unknown',
        code: ERROR_CODE.INTERNAL,
        httpStatus: null,
        retryable: false,
        reportable: true,
    };
}

export function errorCodeOf(error: unknown): ErrorCode {
    return classifyError(error).code;
}

export function isSlotOverlap(error: unknown): boolean {
    return classifyError(error).code === ERROR_CODE.SLOT_OVERLAP;
}

export function isOffline(error: unknown): boolean {
    const kind = classifyError(error).kind;
    return kind === 'offline' || kind === 'timeout';
}
