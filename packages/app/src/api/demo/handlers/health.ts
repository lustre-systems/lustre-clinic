import { clinicZone, offsetAt } from '@lustre/shared';
import type { RouterOutput } from '../../types';
import type { Dated } from '../wire';

export const healthHandlers = {
    check(): Dated<RouterOutput['health']['check']> {
        return { ok: true, db: true, migration: null, tailscale: null, environment: 'development' };
    },

    clock(): Dated<RouterOutput['health']['clock']> {
        const now = Date.now();
        return { now, utcOffsetMinutes: offsetAt(now), zone: clinicZone() };
    },
};
