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
