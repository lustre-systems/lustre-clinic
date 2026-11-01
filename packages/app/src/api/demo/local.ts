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
 * Nothing else has a copy, so the clinic leaves the phone as a JSON file (the
 * format `./localFormat` writes and the server's import reads), handed to
 * Android's share sheet. A file brought back in is the same format again.
 */
import { todayKey } from '@lustre/shared';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { type DemoDb, getDb, isOpen, setDb } from './db';
import { noteLastExportAt } from './exported';
import {
    freshLocalDb,
    hasRecords,
    LocalStoreError,
    parseLocal,
    parseLocalFile,
    reviveLocal,
    serializeLocal,
} from './localFormat';
import { emptyDb } from './seed';

const DATABASE = 'lustre-local.db';
const EXPORTED_AT = 'exportedAt';

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

function store(): SQLiteDatabase {
    if (connection) return connection;
    // Required here rather than imported: it brings react-native with it, and
    // every request path (`./link`) imports this file.
    const { openDatabaseSync } = require('expo-sqlite') as typeof import('expo-sqlite');
    const opened = openDatabaseSync(DATABASE);
    // FULL because a write is reported saved once this returns, power cut included.
    opened.execSync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS clinic_rows (
            seq INTEGER PRIMARY KEY,
            tbl TEXT NOT NULL,
            id TEXT NOT NULL,
            json TEXT NOT NULL,
            UNIQUE (tbl, id)
        );
        CREATE TABLE IF NOT EXISTS clinic_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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

function setExportedAt(database: SQLiteDatabase, at: Date | null): void {
    if (at) {
        database.runSync(
            `INSERT INTO clinic_meta (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
            [EXPORTED_AT, at.toISOString()],
        );
    } else {
        database.runSync('DELETE FROM clinic_meta WHERE key = ?', [EXPORTED_AT]);
    }
    noteLastExportAt(at);
}

/** The whole store swapped for `db` in one transaction: it is one clinic or the other. */
function replaceStore(db: DemoDb, exportedAt: Date | null): void {
    const database = store();
    const rows = rowsOf(db);
    database.withTransactionSync(() => {
        database.runSync('DELETE FROM clinic_rows');
        for (const row of rows.values()) insertRow(database, row);
        setExportedAt(database, exportedAt);
    });
    onFile = rows;
}

function readStore(): DemoDb | null {
    const rows = store().getAllSync<StoredRow>('SELECT tbl, id, json FROM clinic_rows ORDER BY seq');
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

function readLegacyExportStamp(): Date | null {
    const stamp = file(LEGACY_EXPORTED);
    if (!stamp.exists) return null;
    const at = new Date(stamp.textSync());
    return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Into the store first and the files moved after, so a phone that dies between
 * the two has both and opens the store. A renamed file is never read again.
 */
function moveLegacyFile(): DemoDb | null {
    const legacy = readLegacyFile();
    if (!legacy) return null;
    replaceStore(legacy, readLegacyExportStamp());

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
    });
    onFile = rows;
}

function readExportedAt(): Date | null {
    const row = store().getFirstSync<{ value: string }>('SELECT value FROM clinic_meta WHERE key = ?', [
        EXPORTED_AT,
    ]);
    if (!row) return null;
    const at = new Date(row.value);
    return Number.isNaN(at.getTime()) ? null : at;
}

/** The clinic on file, or a new one written down at once so its ids are the ones kept. */
export function openLocalDb(): void {
    const stored = read();
    noteLastExportAt(readExportedAt());
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

/**
 * Hands a copy to the share sheet. Android does not say whether the app picked
 * from it kept the file, so the sheet closing is what counts as an export —
 * a cancelled one included, which is the honest limit of "last export".
 */
export async function exportLocal(dialogTitle: string): Promise<Date> {
    if (!isOpen('local')) openLocalDb();
    const at = new Date();
    const copy = new File(Paths.cache, `lustre-clinic-${todayKey(at.getTime())}.json`);
    copy.write(serializeLocal(getDb(), at));
    // Loaded here rather than imported: it brings react-native with it, and
    // every request path (`./link`) imports this file.
    const { shareAsync } = await import('expo-sharing');
    await shareAsync(copy.uri, { mimeType: 'application/json', dialogTitle });
    setExportedAt(store(), at);
    return at;
}

/** A clinic file read and checked, not yet opened. */
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

/** Null when the picker was closed. Throws `LocalStoreError` for a file that is not a clinic. */
export async function pickClinicFile(): Promise<PickedClinic | null> {
    const picked = await File.pickFileAsync();
    if (picked.canceled) return null;
    const { db, exportedAt } = parseLocalFile(await picked.result.text(), true);
    return { db, exportedAt, replaces: wouldReplace() };
}

/**
 * Makes a picked file the phone's clinic, in one transaction: a failure leaves
 * the old one as it was. The old one is kept aside first, and the file's own
 * export time becomes this phone's last export: that copy is still wherever it
 * was saved.
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
