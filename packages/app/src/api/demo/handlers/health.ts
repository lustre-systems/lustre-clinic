/**
 * `server/src/modules/health/health.service.ts`. In demo mode there is no
 * database to be unavailable and no tailnet address to report — the phone is
 * talking to itself, and `null` is the honest answer to "where else can I be
 * reached", not a missing value.
 */
import { clinicZone, offsetAt } from '@lustre/shared';
import type { RouterOutput } from '../../types';
import type { Dated } from '../wire';

export const healthHandlers = {
    check(): Dated<RouterOutput['health']['check']> {
        return { ok: true, db: true, migration: null, tailscale: null, environment: 'development' };
    },

    // The phone is the server, so its clock always agrees with itself. The
    // zone is the table it already has: bundled, or the last server's.
    clock(): Dated<RouterOutput['health']['clock']> {
        const now = Date.now();
        return { now, utcOffsetMinutes: offsetAt(now), zone: clinicZone() };
    },
};
