/**
 * Local mode's clinic, as it sits in its file: what a new one starts as, and
 * how a stored one is read back. No file system in here, so `bun test` reaches
 * it; `./local` does the reading and writing.
 *
 * Unlike the demo's store (`./db`), a stored clinic is never dropped and
 * reseeded. It is somebody's patients. A file this build cannot read is refused
 * outright, so nothing is written over it, and a row shape that changes gets an
 * upgrade step here rather than a bumped version.
 */
import {
    DEFAULT_CLINIC_NAME,
    LOCAL_CLINIC_FORMAT,
    LOCAL_CLINIC_VERSION,
    localClinicFileSchema,
} from '@lustre/shared';
import { type DemoDb, revive } from './db';
import { uuidv7 } from './rules';
import { emptyDb } from './seed';

/** Sunday is 0, as in `Date#getDay`. Friday is the weekend most clinics here keep. */
const OPEN_WEEKDAYS = [0, 1, 2, 3, 4, 6];

export class LocalStoreError extends Error {}

/**
 * One branch and a working week, so the day view opens on a day that can be
 * booked rather than on "Closed". Both are ordinary settings, changed in
 * Settings like any clinic's. The catalogue starts empty: its prices are the
 * clinic's to write.
 */
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

/** `exportedAt` is stamped on a copy that leaves the phone, never on the phone's own file. */
export function serializeLocal(db: DemoDb, exportedAt?: Date): string {
    return JSON.stringify({ format: LOCAL_CLINIC_FORMAT, version: LOCAL_CLINIC_VERSION, exportedAt, db });
}

export function parseLocal(raw: string): DemoDb {
    return parseLocalFile(raw).db;
}

/**
 * Throws rather than returning nothing: the caller must not take a bad read for an empty clinic.
 *
 * `checkRows` is for a file from outside the phone, which is held to the shared
 * schema the server's import uses, row by row, so a file this phone opens is one
 * a server would take too. The phone's own file is not: a row the schema
 * disagrees with must not lock the clinic out of its own records.
 */
export function parseLocalFile(raw: string, checkRows = false): { db: DemoDb; exportedAt: Date | null } {
    let parsed: { format?: unknown; version?: unknown; exportedAt?: unknown; db?: DemoDb };
    try {
        parsed = JSON.parse(raw) as typeof parsed;
    } catch {
        throw new LocalStoreError('the clinic file is not readable');
    }
    if (parsed.format !== LOCAL_CLINIC_FORMAT || !parsed.db || typeof parsed.db !== 'object') {
        throw new LocalStoreError('the clinic file is not a clinic');
    }
    if (parsed.version !== LOCAL_CLINIC_VERSION) {
        throw new LocalStoreError(`the clinic file is version ${String(parsed.version)}`);
    }
    // A file missing a table would open as a clinic without it, and the next
    // write would put that over the whole clinic. The tables are read off an
    // empty clinic, so one added to `DemoDb` is checked without a list here.
    if (!hasEveryTable(parsed.db)) {
        throw new LocalStoreError('the clinic file is missing part of the clinic');
    }
    // `exportedAt` is left out: one that does not read is dropped below, not refused.
    if (checkRows && !localClinicFileSchema.safeParse({ ...parsed, exportedAt: undefined }).success) {
        throw new LocalStoreError('the clinic file has rows this app cannot read');
    }
    const exportedAt = typeof parsed.exportedAt === 'string' ? new Date(parsed.exportedAt) : null;
    return {
        db: upgrade(revive(parsed.db)),
        exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null,
    };
}

/** Whether opening another clinic over this one would lose anybody's records. */
export function hasRecords(db: DemoDb): boolean {
    return db.patients.length > 0 || db.appointments.length > 0;
}

/**
 * Rows written by an older build, brought up to today's shape. Each step fills
 * what that build did not write with what it meant.
 *
 * - Costs: a procedure nobody priced the cost of costs nothing, and so does a
 *   line on a visit from before costs existed — the stats screen counts old
 *   visits as all profit rather than guessing.
 */
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
