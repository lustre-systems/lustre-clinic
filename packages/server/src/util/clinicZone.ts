/**
 * The clinic zone's offsets, off this machine's ICU, which the server keeps
 * current and a phone's OS image does not. Installed as `clinicTime`'s table
 * for the server's own day arithmetic, and sent to the phones by
 * `health.clock`. Ten years back covers the history a record shows; three
 * ahead covers anything bookable. Rebuilt once a day, so a long-running server
 * never runs off the end. `config.ts` installs it on load, so nothing reads a
 * clinic day before it is in place.
 */
import { type ClinicZone, setClinicZone } from '@lustre/shared';
import { zoneSpans } from '@lustre/shared/zoneSpans';

let timeZone = 'Africa/Cairo';
let built: { day: string; zone: ClinicZone } | null = null;

export function installClinicZone(name: string): void {
    timeZone = name;
    built = null;
    serverClinicZone();
}

export function serverClinicZone(now: Date = new Date()): ClinicZone {
    const day = now.toISOString().slice(0, 10);
    if (built?.day !== day) {
        const year = now.getUTCFullYear();
        const zone = zoneSpans(timeZone, Date.UTC(year - 10, 0, 1), Date.UTC(year + 3, 0, 1));
        built = { day, zone };
        setClinicZone(zone);
    }
    return built.zone;
}
