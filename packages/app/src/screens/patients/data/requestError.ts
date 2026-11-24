import type { ErrorCode } from '@lustre/shared';

export class PatientsRequestError extends Error {
    readonly code: ErrorCode;
    readonly offline: boolean;

    constructor(code: ErrorCode, message: string, options?: { offline?: boolean; cause?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = 'PatientsRequestError';
        this.code = code;
        this.offline = options?.offline ?? false;
    }
}
