import {
    DEFAULT_CLINIC_NAME,
    isAcceptableGzip,
    LOCAL_CLINIC_FORMAT,
    LOCAL_CLINIC_VERSION,
    localClinicFileSchema,
} from '@lustre/shared';
import { gunzipSync } from 'fflate';
import { type DemoDb, revive } from './db';
import { uuidv7 } from './rules';
import { emptyDb } from './seed';

const OPEN_WEEKDAYS = [0, 1, 2, 3, 4, 6];

export class LocalStoreError extends Error {}

export function freshLocalDb(): DemoDb {
    const db = emptyDb();
    const branchId = uuidv7();
    db.branches.push({ id: branchId, name: 'Main', address: null, active: true, whatsappApp: 'regular' });
    db.clinicDays.push(
        ...OPEN_WEEKDAYS.map((weekday) => ({ weekday, branchId, opensAt: '10:00', closesAt: '20:00' })),
    );
    db.settings = {
        ...db.settings,
        clinicName: DEFAULT_CLINIC_NAME,
        clinicPhone: null,
        patientRefNext: 1,
        updatedAt: new Date(),
    };
    return db;
}

export function serializeLocal(db: DemoDb, exportedAt?: Date): string {
    return JSON.stringify({ format: LOCAL_CLINIC_FORMAT, version: LOCAL_CLINIC_VERSION, exportedAt, db });
}

export function parseLocal(raw: string): DemoDb {
    return parseLocalFile(raw).db;
}

function parseLocalFile(raw: string): { db: DemoDb; exportedAt: Date | null } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new LocalStoreError('the clinic file is not readable');
    }
    return readLocalFile(parsed, false);
}

export function inflateSnapshot(gzipped: Uint8Array): Uint8Array {
    if (!isAcceptableGzip(gzipped)) throw new LocalStoreError('the clinic file is not readable');
    try {
        return gunzipSync(gzipped);
    } catch {
        throw new LocalStoreError('the clinic file is not readable');
    }
}

export function readLocalFile(file: unknown, checkRows: boolean): { db: DemoDb; exportedAt: Date | null } {
    const parsed = (file ?? {}) as {
        format?: unknown;
        version?: unknown;
        exportedAt?: unknown;
        db?: DemoDb;
    };
    if (parsed.format !== LOCAL_CLINIC_FORMAT || !parsed.db || typeof parsed.db !== 'object') {
        throw new LocalStoreError('the clinic file is not a clinic');
    }
    if (parsed.version !== LOCAL_CLINIC_VERSION) {
        throw new LocalStoreError(`the clinic file is version ${String(parsed.version)}`);
    }
    if (!hasEveryTable(parsed.db)) {
        throw new LocalStoreError('the clinic file is missing part of the clinic');
    }
    if (checkRows && !localClinicFileSchema.safeParse({ ...parsed, exportedAt: undefined }).success) {
        throw new LocalStoreError('the clinic file has rows this app cannot read');
    }
    const exportedAt = typeof parsed.exportedAt === 'string' ? new Date(parsed.exportedAt) : null;
    return {
        db: reviveLocal(parsed.db),
        exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null,
    };
}

export function hasRecords(db: DemoDb): boolean {
    return db.patients.length > 0 || db.appointments.length > 0;
}

export function reviveLocal(db: DemoDb): DemoDb {
    return upgrade(revive(db));
}

function upgrade(db: DemoDb): DemoDb {
    for (const row of db.procedureTypes) row.cost ??= 0;
    for (const line of db.visitProcedures) line.unitCost ??= 0;
    return db;
}

function hasEveryTable(db: object): boolean {
    const stored = db as Record<string, unknown>;
    return Object.entries(emptyDb()).every(([table, empty]) => {
        const value = stored[table];
        if (Array.isArray(empty)) return Array.isArray(value);
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    });
}
