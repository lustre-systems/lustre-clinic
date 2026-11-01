/**
 * Local mode's file: the whole clinic as one JSON document in the app's own
 * storage. Not AsyncStorage, which Android caps at a few megabytes and cannot
 * read a single value much past two — a few years of a clinic outgrows both.
 *
 * Writing is synchronous and goes to a second file first, which is then moved
 * over the first. A write cut off part way leaves the last good copy behind,
 * and the copy moved over it is complete, so a read tries the main file and
 * falls back to the next one.
 *
 * Nothing else has a copy, so the clinic leaves the phone the one way it can
 * without a server: the same file, handed to Android's share sheet, which
 * reaches Drive, WhatsApp, email and Files without this app holding anyone's
 * Google sign-in. A file brought back in is the same format again.
 */
import { todayKey } from '@lustre/shared';
import { File, Paths } from 'expo-file-system';
import { type DemoDb, getDb, isOpen, setDb } from './db';
import { noteLastExportAt } from './exported';
import {
    freshLocalDb,
    hasRecords,
    LocalStoreError,
    parseLocal,
    parseLocalFile,
    serializeLocal,
} from './localFormat';

const MAIN = 'lustre-local.json';
const NEXT = 'lustre-local.next.json';
/** When a copy last left the phone. Beside the clinic, not in it: an export is not a write to the clinic. */
const EXPORTED = 'lustre-local.exported';
/** The clinic an opened file replaced, kept rather than lost to a wrong tap. */
const REPLACED = 'lustre-local.replaced.json';

function file(name: string): File {
    return new File(Paths.document, name);
}

function read(): ReturnType<typeof parseLocal> | null {
    const candidates = [file(MAIN), file(NEXT)].filter((candidate) => candidate.exists);
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

/** Writes what is open now. Throws when the phone would not take it. */
export function commitLocal(): void {
    const next = file(NEXT);
    next.write(serializeLocal(getDb()));
    next.moveSync(file(MAIN), { overwrite: true });
}

/** The clinic on file, or a new one written down at once so its ids are the ones kept. */
export function openLocalDb(): void {
    const stored = read();
    noteLastExportAt(readExportStamp());
    if (stored) {
        setDb(stored, 'local');
        return;
    }
    setDb(freshLocalDb(), 'local');
    commitLocal();
}

/**
 * Back to what is on file, after a request that failed: a handler can have
 * changed rows before it refused, and the server's transaction would have
 * thrown those away too.
 */
export function rollbackLocal(): void {
    setDb(read() ?? freshLocalDb(), 'local');
}

/** When a copy of the clinic last went to the share sheet, or null for never. */
function readExportStamp(): Date | null {
    const stamp = file(EXPORTED);
    if (!stamp.exists) return null;
    const at = new Date(stamp.textSync());
    return Number.isNaN(at.getTime()) ? null : at;
}

function noteExport(at: Date | null): void {
    noteLastExportAt(at);
    const stamp = file(EXPORTED);
    if (at) stamp.write(at.toISOString());
    else if (stamp.exists) stamp.delete();
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
    noteExport(at);
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
    if (!file(MAIN).exists && !file(NEXT).exists) return false;
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
 * Makes a picked file the phone's clinic. Whatever was on file first is copied
 * aside rather than written over, and the file's own export time becomes this
 * phone's last export: that copy is still wherever it was saved.
 */
export function openClinicFile(picked: PickedClinic): void {
    const main = file(MAIN);
    const next = file(NEXT);
    const kept = main.exists ? main : next.exists ? next : null;
    kept?.copySync(file(REPLACED), { overwrite: true });
    setDb(picked.db, 'local');
    try {
        commitLocal();
    } catch (error) {
        // A move that failed part way can have removed the main file, or
        // already copied the picked clinic over it, so the kept copy goes back
        // either way. If the failure came earlier it is the same file.
        if (kept) file(REPLACED).copySync(main, { overwrite: true });
        rollbackLocal();
        throw error;
    }
    try {
        noteExport(picked.exportedAt);
    } catch {
        // The clinic is already on file; saying the import failed over a
        // timestamp would be the wrong answer.
    }
}
