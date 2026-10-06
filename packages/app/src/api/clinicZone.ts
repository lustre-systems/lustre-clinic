/**
 * Where the phone keeps the clinic zone's offsets (`clinicTime`). The server
 * sends them with every clock check, and they are stored so a phone that
 * starts with the clinic PC off, or in one-phone mode, still converts with the
 * last table it was given. Before any of that, the table bundled at build time
 * stands in. A server too old to send one changes nothing.
 */

import { type ClinicZone, clinicZone, parseClinicZone, setClinicZone } from '@lustre/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lustre.clinicZone';

let adopted = false;

function same(a: ClinicZone, b: ClinicZone): boolean {
    return (
        a.zone === b.zone &&
        a.spans.length === b.spans.length &&
        a.spans.every(
            ([from, offset], index) => b.spans[index]?.[0] === from && b.spans[index]?.[1] === offset,
        )
    );
}

export function adoptClinicZone(value: unknown): void {
    const zone = parseClinicZone(value);
    if (!zone) return;
    adopted = true;
    if (same(zone, clinicZone())) return;
    setClinicZone(zone);
    void AsyncStorage.setItem(KEY, JSON.stringify(zone)).catch(() => {});
}

export async function hydrateClinicZone(): Promise<void> {
    const stored = await AsyncStorage.getItem(KEY).catch(() => null);
    if (adopted || stored === null) return;
    try {
        const zone = parseClinicZone(JSON.parse(stored));
        if (zone) setClinicZone(zone);
    } catch {}
}
