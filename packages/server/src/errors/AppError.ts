/**
 * SPEC §4. Services throw `AppError`; the tRPC `errorFormatter` maps it onto a
 * `TRPCError` and carries `code` through as `shape.data.appCode`.
 *
 * `message` stays English — it is for logs. The client localizes from `code`
 * and never parses the message. `pgErrorCode` walks the `cause` chain because
 * Drizzle wraps driver errors in a `DrizzleQueryError` and hangs the original
 * off `cause`, so the SQLSTATE services switch on is usually a level or two
 * down.
 */
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
    /**
     * Class 40 — the transaction lost a race and Postgres rolled it back
     * whole. Nothing is wrong with the request; running it again against the
     * winner's committed rows is the documented remedy. Two overlapping
     * inserts reach this rather than 23P01 whenever each ends up waiting on
     * the other's transaction, which the walk-in cascade's updates make easy.
     */
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

/** The constraint a refused row broke, for a log line that must not quote the row. */
export function pgConstraint(err: unknown): string | undefined {
    return driverField(err, 'constraint_name');
}
