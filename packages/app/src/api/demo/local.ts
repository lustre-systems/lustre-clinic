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
const REPLACED = 'lustre-local.replaced.json';

function file(name: string): File {
    return new File(Paths.document, name);
}

let connection: SQLiteDatabase | null = null;

function sqlite(): typeof import('expo-sqlite') {
    return require('expo-sqlite') as typeof import('expo-sqlite');
}

function store(): SQLiteDatabase {
    if (connection) return connection;
    const opened = sqlite().openDatabaseSync(DATABASE);
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

let onFile = new Map<string, StoredRow>();

const rowKey = (tbl: string, id: string) => `${tbl}/${id}`;

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

export function rollbackLocal(): void {
    setDb(read() ?? freshLocalDb(), 'local');
}

export function clinicSnapshot(db: DemoDb, exportedAt: Date): Uint8Array {
    return snapshotOf(rowsOf(db).values(), exportedAt);
}

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

export interface PickedClinic {
    db: DemoDb;
    exportedAt: Date | null;
    replaces: boolean;
}

function wouldReplace(): boolean {
    try {
        const current = read();
        return current !== null && hasRecords(current);
    } catch {
        return true;
    }
}

export function pickedFromSnapshot(gzipped: Uint8Array): PickedClinic {
    const { db, exportedAt } = readClinicSnapshot(gzipped);
    return { db, exportedAt, replaces: wouldReplace() };
}

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
        const legacy = file(LEGACY_MAIN);
        if (legacy.exists) legacy.copySync(aside, { overwrite: true });
    }
}
