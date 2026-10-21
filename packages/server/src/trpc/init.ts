/**
 * SPEC §4. The context is `{ db, token }`: the database, and the credential a
 * provisioned phone sends (`device.service.ts`). There are still no accounts —
 * the phone is the account, and its credential says which role it was granted.
 *
 * Services throw `AppError` and never import tRPC; the `errorMapper` middleware
 * is the one place that translates. It carries `code` through as
 * `shape.data.appCode` — the client switches on it and localizes from it, never
 * parsing `message` (§4). Expected domain failures are logged with IDs and codes
 * only (never patient data); anything else that escapes a procedure is logged
 * with its stack, reported (§17) with path and error name only, and returned to
 * the client as INTERNAL.
 *
 * Tailscale is still the outer boundary (§1). Inside it there are four
 * procedure kinds: `publicProcedure` for what a phone needs before it has a
 * role (health, the APK, redeeming a code); `clinicProcedure` for everything
 * else, which resolves the caller and refuses a revoked phone or, once the
 * clinic requires it, an unprovisioned one; and on top of that
 * `paymentProcedure`, which a doctor may not call, `statsProcedure` for the
 * clinic's own figures, which only an admin may see, `setupProcedure` for
 * setting the clinic up, which only an admin may, and `adminProcedure`.
 */
import { ERROR_CODE, type ErrorCode } from '@lustre/shared';
import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { db } from '../db/index.ts';
import { AppError, isAppError } from '../errors/AppError.ts';
import { logger } from '../logger.ts';
import { deviceService, tokenFrom } from '../modules/device/device.service.ts';
import { alert } from '../monitoring/index.ts';

export function createContext({ req }: { req: Request }) {
    return { db, token: tokenFrom(req.headers) };
}

type Context = ReturnType<typeof createContext>;

function trpcCodeFor(httpStatus: number): TRPCError['code'] {
    switch (httpStatus) {
        case 401:
            return 'UNAUTHORIZED';
        case 403:
            return 'FORBIDDEN';
        case 404:
            return 'NOT_FOUND';
        case 409:
            return 'CONFLICT';
        case 422:
            return 'UNPROCESSABLE_CONTENT';
        case 500:
            return 'INTERNAL_SERVER_ERROR';
        default:
            return 'BAD_REQUEST';
    }
}

const t = initTRPC.context<Context>().create({
    errorFormatter({ shape, error }) {
        const cause = error.cause;

        let appCode: ErrorCode = ERROR_CODE.INTERNAL;

        if (isAppError(cause)) {
            appCode = cause.code;
        } else if (cause instanceof ZodError || error.code === 'BAD_REQUEST') {
            appCode = ERROR_CODE.VALIDATION;
        } else if (error.code === 'NOT_FOUND') {
            appCode = ERROR_CODE.NOT_FOUND;
        }

        return {
            ...shape,
            data: {
                ...shape.data,
                appCode,
            },
        };
    },
});

const errorMapper = t.middleware(async ({ next, path }) => {
    const result = await next();
    if (result.ok) return result;

    const cause = result.error.cause;

    if (isAppError(cause)) {
        logger.warn({ appCode: cause.code, path }, 'procedure failed');
        throw new TRPCError({
            code: trpcCodeFor(cause.httpStatus),
            message: cause.message,
            cause,
        });
    }

    if (cause instanceof ZodError || result.error.code === 'BAD_REQUEST') {
        logger.warn({ appCode: ERROR_CODE.VALIDATION, path }, 'invalid input');
        return result;
    }

    logger.error({ err: result.error, path }, 'unhandled procedure error');
    void alert({
        code: 'trpc.unhandled_error',
        summary: 'A procedure failed with an unexpected error.',
        context: { path: path ?? null, error: cause instanceof Error ? cause.name : typeof cause },
    });
    throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal error',
        cause: AppError.internal('Internal error', { cause: result.error }),
    });
});

export const router = t.router;

export const publicProcedure = t.procedure.use(errorMapper);

export const clinicProcedure = publicProcedure.use(async ({ ctx, next }) =>
    next({ ctx: { caller: await deviceService.authorize(ctx.token) } }),
);

export const paymentProcedure = clinicProcedure.use(({ ctx, next }) => {
    deviceService.assertSeesPayments(ctx.caller);
    return next();
});

export const statsProcedure = clinicProcedure.use(({ ctx, next }) => {
    deviceService.assertSeesStats(ctx.caller);
    return next();
});

export const setupProcedure = clinicProcedure.use(({ ctx, next }) => {
    deviceService.assertManagesClinic(ctx.caller);
    return next();
});

export const adminProcedure = clinicProcedure.use(({ ctx, next }) => {
    deviceService.assertAdmin(ctx.caller);
    return next();
});
