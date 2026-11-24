import { ERROR_CODE, type ErrorCode } from '@lustre/shared';

export class AppError extends Error {
    readonly code: ErrorCode;
    readonly httpStatus: number;

    constructor(code: ErrorCode, message: string, httpStatus = 400, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'AppError';
        this.code = code;
        this.httpStatus = httpStatus;
    }

    static notFound(what: string): AppError {
        return new AppError(ERROR_CODE.NOT_FOUND, `${what} not found`, 404);
    }

    static internal(message = 'Internal error', options?: { cause?: unknown }): AppError {
        return new AppError(ERROR_CODE.INTERNAL, message, 500, options);
    }
}

export function isAppError(err: unknown): err is AppError {
    return err instanceof AppError;
}

export const PG_ERROR = {
    UNIQUE_VIOLATION: '23505',
    EXCLUSION_VIOLATION: '23P01',
    CHECK_VIOLATION: '23514',
    FOREIGN_KEY_VIOLATION: '23503',
    SERIALIZATION_FAILURE: '40001',
    DEADLOCK_DETECTED: '40P01',
} as const;

function driverField(err: unknown, field: 'code' | 'constraint_name'): string | undefined {
    let current: unknown = err;

    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
        const value = (current as Record<string, unknown>)[field];
        if (typeof value === 'string') return value;
        current = (current as { cause?: unknown }).cause;
    }
    return undefined;
}

export function pgErrorCode(err: unknown): string | undefined {
    return driverField(err, 'code');
}

export function pgConstraint(err: unknown): string | undefined {
    return driverField(err, 'constraint_name');
}
