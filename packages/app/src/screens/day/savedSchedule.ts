import type { AppointmentStatus } from '@lustre/shared';
import { rowSummary } from './agenda';
import type { Appointment, Branch } from './data/types';

const VERSION = 1;

export interface SavedRow {
    id: string;
    startsAt: string;
    durationMinutes: number;
    status: AppointmentStatus;
    branchId: string;
    name: string;
    phone: string;
    summary: string | null;
}

export interface SavedDay {
    date: string;
    rows: SavedRow[];
}

export interface SavedSchedule {
    version: typeof VERSION;
    server: string;
    savedAt: number;
    branches: Array<{ id: string; name: string }>;
    days: SavedDay[];
}

export function takeSchedule(input: {
    server: string;
    savedAt: number;
    branches: readonly Branch[];
    days: ReadonlyArray<{ date: string; appointments: readonly Appointment[] }>;
}): SavedSchedule {
    return {
        version: VERSION,
        server: input.server,
        savedAt: input.savedAt,
        branches: input.branches.map(({ id, name }) => ({ id, name })),
        days: input.days.map(({ date, appointments }) => ({
            date,
            rows: appointments
                .filter((row) => row.status !== 'cancelled')
                .map((row) => ({
                    id: row.id,
                    startsAt: row.startsAt,
                    durationMinutes: row.durationMinutes,
                    status: row.status,
                    branchId: row.branchId,
                    name: row.patient.name,
                    phone: row.patient.phone,
                    summary: rowSummary(row) ?? null,
                }))
                .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
        })),
    };
}

export function usableSchedule(
    raw: string | null,
    server: string | null,
    today: string,
): SavedSchedule | null {
    if (!raw || !server) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isSchedule(parsed) || parsed.server !== server) return null;

    const days = parsed.days.filter((day) => day.date >= today);
    return days.length > 0 ? { ...parsed, days } : null;
}

function isSchedule(value: unknown): value is SavedSchedule {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<SavedSchedule>;
    return (
        candidate.version === VERSION &&
        typeof candidate.server === 'string' &&
        typeof candidate.savedAt === 'number' &&
        Array.isArray(candidate.branches) &&
        Array.isArray(candidate.days) &&
        candidate.days.every((day) => typeof day?.date === 'string' && Array.isArray(day.rows))
    );
}

export function serverIdentity(addresses: { lan: string | null; tailscale: string | null }): string | null {
    return addresses.tailscale ?? addresses.lan;
}
