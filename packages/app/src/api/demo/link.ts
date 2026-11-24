import type { AppRouter } from '@lustre/server/src/trpc/router.ts';
import { ERROR_CODE, type ErrorCode } from '@lustre/shared';
import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { credentialToken, forgetDemoCredential, noteRefusal } from '../credential';
import { admit, inputFor, shownTo } from './access';
import { getDb, isOpen, loadStored, setDb, takeDirty } from './db';
import { type DeviceBackend, deviceBackend } from './flag';
import { hasHandler, resolve } from './handlers';
import { commitLocal, openLocalDb, rollbackLocal } from './local';
import { hydrateDriveLink } from './localDrive';
import { DemoError } from './rules';
import { seedDemoDb } from './seed';

const LATENCY_MS = { query: 120, mutation: 240 } as const;

const TRPC_CODE: Record<number, number> = {
    401: -32001,
    403: -32003,
    404: -32004,
    409: -32009,
    422: -32022,
    500: -32603,
};

function toWire(value: unknown): unknown {
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

function failure(path: string, error: unknown): TRPCClientError<AppRouter> {
    const demo = error instanceof DemoError ? error : null;
    const appCode: ErrorCode = demo?.code ?? ERROR_CODE.INTERNAL;
    const httpStatus = demo?.httpStatus ?? 500;
    const message = error instanceof Error ? error.message : 'demo backend failed';

    return TRPCClientError.from({
        error: {
            code: TRPC_CODE[httpStatus] ?? -32600,
            message,
            data: { appCode, httpStatus, code: appCode, path },
        },
    });
}

let opening: Promise<void> | null = null;

export function openDeviceDb(backend: DeviceBackend = deviceBackend() ?? 'demo'): Promise<void> {
    if (backend === 'local') {
        if (!isOpen('local')) {
            openLocalDb();
            hydrateDriveLink();
        }
        return Promise.resolve();
    }
    if (isOpen('demo')) return Promise.resolve();
    if (opening) return opening;

    opening = loadStored()
        .then((stored) => {
            if (stored) {
                setDb(stored);
                return;
            }
            setDb(seedDemoDb());
            forgetDemoCredential();
        })
        .finally(() => {
            opening = null;
        });

    return opening;
}

function settleLocal(answer: () => unknown, writes: boolean): unknown {
    try {
        const output = answer();
        if (takeDirty()) commitLocal();
        return output;
    } catch (error) {
        if (takeDirty() || writes) rollbackLocal();
        if (error instanceof DemoError) throw error;
        throw new DemoError(ERROR_CODE.INTERNAL, 'this phone did not save it', 500);
    }
}

export const demoLink: TRPCLink<AppRouter> = () => {
    return ({ op }) =>
        observable((observer) => {
            let cancelled = false;

            const run = async () => {
                const backend = deviceBackend() ?? 'demo';
                await openDeviceDb(backend);

                if (backend === 'demo') {
                    const wait = op.type === 'mutation' ? LATENCY_MS.mutation : LATENCY_MS.query;
                    await new Promise((done) => setTimeout(done, wait));
                }

                if (cancelled || op.signal?.aborted) return;

                const path = op.path;
                if (!hasHandler(path)) {
                    throw new DemoError(ERROR_CODE.NOT_FOUND, `${op.path} is not answered in demo mode`, 404);
                }

                getDb();

                const token = credentialToken();
                try {
                    const caller = admit(op.path, token, op.input);
                    const answer = () => resolve(path, inputFor(path, op.input, caller), caller);
                    const output =
                        backend === 'local' ? settleLocal(answer, op.type === 'mutation') : answer();
                    return toWire(shownTo(op.path, output, caller));
                } catch (error) {
                    if (error instanceof DemoError && error.code === ERROR_CODE.DEVICE_REVOKED) {
                        noteRefusal('revoked', token);
                    } else if (
                        error instanceof DemoError &&
                        error.code === ERROR_CODE.DEVICE_NOT_PROVISIONED
                    ) {
                        noteRefusal('unprovisioned', token);
                    }
                    throw error;
                }
            };

            run().then(
                (data) => {
                    if (cancelled) return;
                    observer.next({ result: { type: 'data', data } });
                    observer.complete();
                },
                (error: unknown) => {
                    if (cancelled) return;
                    observer.error(failure(op.path, error));
                },
            );

            return () => {
                cancelled = true;
            };
        });
};
