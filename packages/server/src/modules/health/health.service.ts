/**
 * SPEC §13/§14. The client probes this on the Tailscale hostname, and a dev
 * build on its LAN address first, so it must be cheap and must not throw — an
 * unreachable database is a reportable state, not an error.
 */
import type { ClinicZone } from '@lustre/shared';
import { utcOffsetMinutes } from '@lustre/shared/zoneSpans';
import { sql as raw } from 'drizzle-orm';
import { config, serverEnvironment, tailnetAddress } from '../../config.ts';
import { db, sql } from '../../db/index.ts';
import { serverClinicZone } from '../../util/clinicZone.ts';

interface HealthReport {
    ok: boolean;
    db: boolean;
    migration: string | null;
    /**
     * Where to reach this machine from elsewhere on the tailnet, or `null` when
     * the clinic has not said. The app stores it so the address is configured
     * once here rather than on every phone, and re-reads it on each connection
     * so moving the server is a one-line change the handsets pick up by
     * themselves.
     */
    tailscale: string | null;
    /**
     * Which stack answered. A dev build connects only to `development`, so a
     * dev phone can never read or write the clinic's own records.
     */
    environment: 'production' | 'development';
}

interface ClockReport {
    /** This machine's clock, in epoch milliseconds. */
    now: number;
    /** The clinic's offset from UTC right now, in minutes east — DST included. */
    utcOffsetMinutes: number;
    /**
     * The clinic zone's offsets over the years around now. The app converts
     * every time with this rather than its own zone data, which on an old
     * phone predates Egypt's summer time (`clinicTime`). Older servers leave
     * it out, and the app falls back on the table it was built with.
     */
    zone: ClinicZone;
}

export const healthService = {
    clock(): ClockReport {
        const now = new Date();
        return {
            now: now.getTime(),
            utcOffsetMinutes: utcOffsetMinutes(config.CLINIC_TIME_ZONE, now),
            zone: serverClinicZone(now),
        };
    },

    async check(): Promise<HealthReport> {
        let dbOk = false;
        let migration: string | null = null;

        try {
            await db.execute(raw`SELECT 1`);
            dbOk = true;

            const rows = await sql<{ hash: string; created_at: string }[]>`
                SELECT hash, created_at
                FROM drizzle.__drizzle_migrations
                ORDER BY created_at DESC
                LIMIT 1
            `;
            migration = rows[0]?.hash ?? null;
        } catch {}

        return { ok: dbOk, db: dbOk, migration, tailscale: tailnetAddress, environment: serverEnvironment };
    },
};
