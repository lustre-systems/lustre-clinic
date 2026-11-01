/**
 * The terminating tRPC link that answers out of `./handlers` instead of over
 * HTTP.
 *
 * Two things make what comes out of here the same shape as what comes out of
 * the clinic server, which is the whole point of doing it at this level rather
 * than stubbing each screen's data layer:
 *
 * - **The wire's types, not the handlers'.** The handlers deal in `Date`,
 *   because the services they mirror do. There is no transformer on either side
 *   (`api/types.ts`), so a `timestamptz` reaches the app as the ISO string JSON
 *   made of it, and every screen already parses one. `toWire` is that JSON
 *   round trip, so demo mode cannot be the one place a date arrives as an
 *   object.
 * - **The client's error contract.** A failure comes back as a
 *   `TRPCClientError` carrying `data.appCode`, which is what `errors.ts`
 *   classifies and what every screen localizes from. A demo that threw plain
 *   `Error`s would take every refusal — a double booking, a payment over the
 *   balance — to the generic failure message.
 *
 * The delay is deliberate. The screens have pending states written for a round
 * trip over Tailscale, and answering in under a millisecond does not exercise
 * them: buttons never show their spinner, and optimistic updates land before
 * anyone sees the transition. This is a fifth of the realistic worst case,
 * which is enough for those states to read as intended without the demo feeling
 * slow.
 *
 * Local mode answers through the same handlers, as a real clinic: no delay, and
 * a write is on file before it is answered (`./local`). One that cannot be
 * written is refused, and the rows go back to what the file holds, so nothing
 * is shown as saved that was not.
 */
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
import { DemoError } from './rules';
import { seedDemoDb } from './seed';

const LATENCY_MS = { query: 120, mutation: 240 } as const;

/** JSONRPC2 error codes, picked the way the server's `trpcCodeFor` picks them. */
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

/**
 * Opened once, on the first request rather than at import: a seed that runs
 * during module evaluation runs on every launch of the real app too. Opened
 * again when the phone moves between the demo and its own clinic.
 */
export function openDeviceDb(backend: DeviceBackend = deviceBackend() ?? 'demo'): Promise<void> {
    if (backend === 'local') {
        if (!isOpen('local')) openLocalDb();
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
            // A new seed has no devices, so the token the phone kept from the
            // last one would be refused as withdrawn, and that refusal persists.
            setDb(seedDemoDb());
            forgetDemoCredential();
        })
        .finally(() => {
            opening = null;
        });

    return opening;
}

/** What a local request answered, once anything it wrote is on file. */
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

                // Read once here rather than inside every handler: `getDb`
                // throws until the open above has finished.
                getDb();

                // The server's credential check, against the demo's devices.
                // A refusal reaches the shell the way the server's does.
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
