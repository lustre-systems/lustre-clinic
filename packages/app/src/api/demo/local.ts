/**
 * Local mode's store: the whole clinic in one SQLite database in the app's own
 * storage, a row per record. The handlers keep working on the arrays they share
 * with the demo (`./db`); this writes down what a request changed, one
 * transaction per commit, so a save costs the rows it touched and a write cut
 * off part way leaves the last commit standing.
 *
 * Rows are stored as JSON under their table and key rather than in columns: the
 * arrays are what gets queried, and a row shape that changes then needs an
 * upgrade step in `./localFormat` and no schema migration on anybody's phone.
 *
 * A phone from before this kept the clinic as one JSON file. The first open
 * moves it in and keeps the file renamed beside the database.
 *
 * Nothing else has a copy, so the clinic leaves the phone as a gzipped SQLite
 * snapshot for `./localDrive` to upload: the same two tables, built in memory so
 * no plain copy of the clinic is left on disk. A backup brought back in has every
 * row checked against the shared schema.
 */
import {
    assembleLocalClinicFile,
    LOCAL_CLINIC_FORMAT,
    LOCAL_CLINIC_META_SQL,
    LOCAL_CLINIC_ROWS_SQL,
    LOCAL_CLINIC_TABLES_SQL,
    LOCAL_CLINIC_VERSION,
} from '@lustre/shared';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { gzipSync } from 'fflate';
import { type DemoDb, getDb, setDb } from './db';
import { noteDriveUnsaved, noteLastDriveBackupAt } from './exported';
import {
    freshLocalDb,
    hasRecords,
    inflateSnapshot,
    LocalStoreError,
    parseLocal,
    readLocalFile,
    reviveLocal,
    serializeLocal,
} from './localFormat';
import { emptyDb } from './seed';

const DATABASE = 'lustre-local.db';
const EXPORTED_AT = 'exportedAt';
const DRIVE_BACKUP_AT = 'driveBackupAt';
const DRIVE_DIRTY = 'driveDirty';

const LEGACY_MAIN = 'lustre-local.json';
const LEGACY_NEXT = 'lustre-local.next.json';
const LEGACY_EXPORTED = 'lustre-local.exported';
const LEGACY_MOVED = 'lustre-local.moved-to-sqlite.json';
/** The clinic an opened file replaced, kept rather than lost to a wrong tap. */
const REPLACED = 'lustre-local.replaced.json';

function file(name: string): File {
    return new File(Paths.document, name);
}

let connection: SQLiteDatabase | null = null;

// Required here rather than imported: it brings react-native with it, and
// every request path (`./link`) imports this file.
function sqlite(): typeof import('expo-sqlite') {
    return require('expo-sqlite') as typeof import('expo-sqlite');
}

function store(): SQLiteDatabase {
    if (connection) return connection;
    const opened = sqlite().openDatabaseSync(DATABASE);
    // FULL because a write is reported saved once this returns, power cut included.
    opened.execSync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        ${LOCAL_CLINIC_TABLES_SQL}
    `);
    connection = opened;
    return opened;
}

interface StoredRow {
    tbl: string;
    id: string;
    json: string;
}

/** What the store holds, so a commit writes only what differs. */
let onFile = new Map<string, StoredRow>();

const rowKey = (tbl: string, id: string) => `${tbl}/${id}`;

/** `settings` is one object, `clinicDays` has its weekday for a key, and the rest an id. */
function rowsOf(db: DemoDb): Map<string, StoredRow> {
    const rows = new Map<string, StoredRow>();
    for (const [tbl, value] of Object.entries(db)) {
        const list: unknown[] = Array.isArray(value) ? value : [value];
        for (const row of list) {
            const { id, weekday } = row as { id?: string; weekday?: number };
            const key = id ?? (weekday === undefined ? tbl : String(weekday));
            rows.set(rowKey(tbl, key), { tbl, id: key, json: JSON.stringify(row) });
        }
    }
    return rows;
}

function insertRow(database: SQLiteDatabase, row: StoredRow): void {
    database.runSync(
        `INSERT INTO clinic_rows (tbl, id, json) VALUES (?, ?, ?)
         ON CONFLICT (tbl, id) DO UPDATE SET json = excluded.json`,
        [row.tbl, row.id, row.json],
    );
}

function writeMeta(database: SQLiteDatabase, key: string, value: string): void {
    database.runSync(
        `INSERT INTO clinic_meta (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [key, value],
    );
}

function readMeta(key: string): string | null {
    return (
        store().getFirstSync<{ value: string }>('SELECT value FROM clinic_meta WHERE key = ?', [key])
            ?.value ?? null
    );
}

function setDirty(database: SQLiteDatabase, dirty: boolean): void {
    writeMeta(database, DRIVE_DIRTY, dirty ? '1' : '0');
    noteDriveUnsaved(dirty);
}

/**
 * The whole store swapped for `db` in one transaction: it is one clinic or the
 * other. `backedUpAt` is for a clinic that came out of a backup: that copy is
 * already in Drive, so there is nothing new to send until it changes.
 */
function replaceStore(db: DemoDb, backedUpAt: Date | null): void {
    const database = store();
    const rows = rowsOf(db);
    database.withTransactionSync(() => {
        database.runSync('DELETE FROM clinic_rows');
        for (const row of rows.values()) insertRow(database, row);
        if (backedUpAt) writeMeta(database, DRIVE_BACKUP_AT, backedUpAt.toISOString());
        else database.runSync('DELETE FROM clinic_meta WHERE key = ?', [DRIVE_BACKUP_AT]);
        setDirty(database, backedUpAt === null);
    });
    noteLastDriveBackupAt(backedUpAt);
    onFile = rows;
}

function readStore(): DemoDb | null {
    const rows = store().getAllSync<StoredRow>(LOCAL_CLINIC_ROWS_SQL);
    if (rows.length === 0) return null;

    const raw = emptyDb() as unknown as Record<string, unknown>;
    let hasSettings = false;
    try {
        for (const { tbl, json } of rows) {
            const list = raw[tbl];
            if (Array.isArray(list)) list.push(JSON.parse(json));
            else if (tbl === 'settings') {
                raw[tbl] = JSON.parse(json);
                hasSettings = true;
            }
        }
    } catch {
        throw new LocalStoreError('the clinic store is not readable');
    }
    // Refused rather than opened on the defaults: the next write would keep them.
    if (!hasSettings) throw new LocalStoreError('the clinic store is missing part of the clinic');

    onFile = new Map(rows.map((row) => [rowKey(row.tbl, row.id), row]));
    return reviveLocal(raw as unknown as DemoDb);
}

function readLegacyFile(): DemoDb | null {
    const candidates = [file(LEGACY_MAIN), file(LEGACY_NEXT)].filter((candidate) => candidate.exists);
    if (candidates.length === 0) return null;

    let failure: unknown = null;
    for (const candidate of candidates) {
        try {
            return parseLocal(candidate.textSync());
        } catch (error) {
            failure = error;
        }
    }
    throw failure instanceof LocalStoreError
        ? failure
        : new LocalStoreError('the clinic file could not be read');
}

/**
 * Into the store first and the files moved after, so a phone that dies between
 * the two has both and opens the store. A renamed file is never read again.
 */
function moveLegacyFile(): DemoDb | null {
    const legacy = readLegacyFile();
    if (!legacy) return null;
    replaceStore(legacy, null);

    const main = file(LEGACY_MAIN);
    const next = file(LEGACY_NEXT);
    if (main.exists) main.moveSync(file(LEGACY_MOVED), { overwrite: true });
    else if (next.exists) next.moveSync(file(LEGACY_MOVED), { overwrite: true });
    if (next.exists) next.delete();
    const stamp = file(LEGACY_EXPORTED);
    if (stamp.exists) stamp.delete();
    return legacy;
}

function read(): DemoDb | null {
    return readStore() ?? moveLegacyFile();
}

/** Writes what is open now. Throws when the phone would not take it, with nothing written. */
export function commitLocal(): void {
    const database = store();
    const rows = rowsOf(getDb());
    const changed = [...rows.entries()].filter(([key, row]) => onFile.get(key)?.json !== row.json);
    const removed = [...onFile.entries()].filter(([key]) => !rows.has(key));
    if (changed.length === 0 && removed.length === 0) return;

    database.withTransactionSync(() => {
        for (const [, row] of removed) {
            database.runSync('DELETE FROM clinic_rows WHERE tbl = ? AND id = ?', [row.tbl, row.id]);
        }
        for (const [, row] of changed) insertRow(database, row);
        setDirty(database, true);
    });
    onFile = rows;
}

function readInstant(key: string): Date | null {
    const value = readMeta(key);
    if (!value) return null;
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
}

/** What the daily Drive check goes on. */
export function readDriveMeta(): { lastBackupAt: Date | null; dirty: boolean } {
    return { lastBackupAt: readInstant(DRIVE_BACKUP_AT), dirty: readMeta(DRIVE_DIRTY) === '1' };
}

export function takeDriveDirty(): void {
    setDirty(store(), false);
}

export function noteDriveDirty(): void {
    setDirty(store(), true);
}

export function writeDriveBackupAt(at: Date): void {
    writeMeta(store(), DRIVE_BACKUP_AT, at.toISOString());
    noteLastDriveBackupAt(at);
}

/** The clinic on file, or a new one written down at once so its ids are the ones kept. */
export function openLocalDb(): void {
    const stored = read();
    noteLastDriveBackupAt(readInstant(DRIVE_BACKUP_AT));
    noteDriveUnsaved(readMeta(DRIVE_DIRTY) === '1');
    if (stored) {
        setDb(stored, 'local');
        return;
    }
    const fresh = freshLocalDb();
    replaceStore(fresh, null);
    setDb(fresh, 'local');
}

/**
 * Back to what is on file, after a request that failed: a handler can have
 * changed rows before it refused, and the server's transaction would have
 * thrown those away too.
 */
export function rollbackLocal(): void {
    setDb(read() ?? freshLocalDb(), 'local');
}

/** `db` as a backup: the bytes of a gzipped SQLite database, stamped with when it left. */
export function clinicSnapshot(db: DemoDb, exportedAt: Date): Uint8Array {
    return snapshotOf(rowsOf(db).values(), exportedAt);
}

/**
 * What is committed, rather than what is open: the background task runs beside
 * whatever a request has half changed, and may be the only thing running.
 */
export function storeSnapshot(exportedAt: Date): Uint8Array {
    return snapshotOf(store().getAllSync<StoredRow>(LOCAL_CLINIC_ROWS_SQL), exportedAt);
}

export function storeHasRecords(): boolean {
    return (
        store().getFirstSync<{ found: number }>(
            "SELECT count(*) AS found FROM clinic_rows WHERE tbl IN ('patients', 'appointments')",
            [],
        )?.found !== 0
    );
}

function snapshotOf(rows: Iterable<StoredRow>, exportedAt: Date): Uint8Array {
    const snapshot = sqlite().openDatabaseSync(':memory:');
    try {
        snapshot.execSync(LOCAL_CLINIC_TABLES_SQL);
        snapshot.withTransactionSync(() => {
            for (const row of rows) insertRow(snapshot, row);
            const meta = [
                ['format', LOCAL_CLINIC_FORMAT],
                ['version', String(LOCAL_CLINIC_VERSION)],
                [EXPORTED_AT, exportedAt.toISOString()],
            ];
            for (const [key, value] of meta) {
                snapshot.runSync('INSERT INTO clinic_meta (key, value) VALUES (?, ?)', [
                    key as string,
                    value as string,
                ]);
            }
        });
        return gzipSync(snapshot.serializeSync());
    } finally {
        snapshot.closeSync();
    }
}

/** Throws `LocalStoreError` for anything that is not a clinic this build can read. */
function readClinicSnapshot(gzipped: Uint8Array): { db: DemoDb; exportedAt: Date | null } {
    const bytes = inflateSnapshot(gzipped);
    let file: unknown;
    try {
        const snapshot = sqlite().deserializeDatabaseSync(bytes);
        try {
            file = assembleLocalClinicFile(
                snapshot.getAllSync<StoredRow>(LOCAL_CLINIC_ROWS_SQL),
                snapshot.getAllSync<{ key: string; value: string }>(LOCAL_CLINIC_META_SQL),
            );
        } finally {
            snapshot.closeSync();
        }
    } catch {
        throw new LocalStoreError('the clinic file is not readable');
    }
    return readLocalFile(file, true);
}

/** A backup read and checked, not yet opened. */
export interface PickedClinic {
    db: DemoDb;
    exportedAt: Date | null;
    /** The phone has a clinic with patients or bookings in it that this would replace. */
    replaces: boolean;
}

function wouldReplace(): boolean {
    try {
        const current = read();
        return current !== null && hasRecords(current);
    } catch {
        // Unreadable is not empty: whatever is in there is kept aside all the same.
        return true;
    }
}

/** Throws `LocalStoreError` for a backup that is not a clinic this build can read. */
export function pickedFromSnapshot(gzipped: Uint8Array): PickedClinic {
    const { db, exportedAt } = readClinicSnapshot(gzipped);
    return { db, exportedAt, replaces: wouldReplace() };
}

/**
 * Makes a backup the phone's clinic, in one transaction: a failure leaves the
 * old one as it was. The old one is kept aside first.
 */
export function openClinicFile(picked: PickedClinic): void {
    keepAside();
    replaceStore(picked.db, picked.exportedAt);
    setDb(picked.db, 'local');
}

function keepAside(): void {
    const aside = file(REPLACED);
    try {
        const current = read();
        if (current) aside.write(serializeLocal(current));
    } catch {
        // Not readable as a clinic, so not writable as one. A file this phone
        // never managed to move in is still whole, and goes aside as it is.
        const legacy = file(LEGACY_MAIN);
        if (legacy.exists) legacy.copySync(aside, { overwrite: true });
    }
}
