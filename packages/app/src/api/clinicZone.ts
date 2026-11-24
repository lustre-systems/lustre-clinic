import { type ClinicZone, clinicZone, parseClinicZone, setClinicZone } from '@lustre/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lustre.clinicZone';

let adopted = false;
let stored: ClinicZone | null = null;

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
    if (!same(zone, clinicZone())) setClinicZone(zone);
    if (stored && same(zone, stored)) return;
    void AsyncStorage.setItem(KEY, JSON.stringify(zone))
        .then(() => {
            stored = zone;
        })
        .catch(() => {});
}

export async function hydrateClinicZone(): Promise<void> {
    const raw = await AsyncStorage.getItem(KEY).catch(() => null);
    if (adopted || raw === null) return;
    try {
        const zone = parseClinicZone(JSON.parse(raw));
        if (!zone) return;
        setClinicZone(zone);
        stored = zone;
    } catch {}
}
