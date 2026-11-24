import { ERROR_CODE, type ErrorCode } from '@lustre/shared';

export class RequestError extends Error {
    readonly code: ErrorCode;
    readonly offline: boolean;

    constructor(code: ErrorCode, message: string, options?: { offline?: boolean; cause?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = 'RequestError';
        this.code = code;
        this.offline = options?.offline ?? false;
    }
}

export function asRequestError(err: unknown): RequestError {
    if (err instanceof RequestError) return err;
    return new RequestError(ERROR_CODE.INTERNAL, err instanceof Error ? err.message : 'request failed', {
        cause: err,
    });
}
