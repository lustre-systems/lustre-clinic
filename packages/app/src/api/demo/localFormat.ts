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
import { DEFAULT_CLINIC_NAME } from '@lustre/shared';
import { type DemoDb, revive } from './db';
import { uuidv7 } from './rules';
import { emptyDb } from './seed';

const FORMAT = 'lustre-local';
const VERSION = 1;

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

export function serializeLocal(db: DemoDb): string {
    return JSON.stringify({ format: FORMAT, version: VERSION, db });
}

/** Throws rather than returning nothing: the caller must not take a bad read for an empty clinic. */
export function parseLocal(raw: string): DemoDb {
    let parsed: { format?: unknown; version?: unknown; db?: DemoDb };
    try {
        parsed = JSON.parse(raw) as typeof parsed;
    } catch {
        throw new LocalStoreError('the clinic file is not readable');
    }
    if (parsed.format !== FORMAT || !parsed.db || typeof parsed.db !== 'object') {
        throw new LocalStoreError('the clinic file is not a clinic');
    }
    if (parsed.version !== VERSION) {
        throw new LocalStoreError(`the clinic file is version ${String(parsed.version)}`);
    }
    // A file missing a table would open as a clinic without it, and the next
    // write would put that over the whole clinic. The tables are read off an
    // empty clinic, so one added to `DemoDb` is checked without a list here.
    if (!hasEveryTable(parsed.db)) {
        throw new LocalStoreError('the clinic file is missing part of the clinic');
    }
    return upgrade(revive(parsed.db));
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
