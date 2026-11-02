/**
 * Local mode's automatic backups: a snapshot of the clinic into the hidden app
 * folder of the phone's own Google account, once a day when anything changed,
 * and on request. There is no clinic server here to hold the Google grant, so
 * this one is the exception to "no refresh token on a handset": it sits in the
 * Android keystore (`expo-secure-store`), and is good for this account's hidden
 * folder and nothing else in it.
 *
 * An unchanged clinic uploads nothing. Fourteen quiet days would otherwise push
 * every backup that differs out of the fourteen kept.
 */
import { todayKey } from '@lustre/shared';
import Constants from 'expo-constants';
import {
    backupsPastKept,
    type DriveBackup,
    DriveError,
    type DriveFetch,
    deleteBackup,
    downloadBackup,
    driveAccount,
    listBackups,
    uploadBackup,
} from './drive';
import { noteDriveLink } from './exported';
import {
    noteDriveDirty,
    type PickedClinic,
    pickedFromSnapshot,
    readDriveMeta,
    storeHasRecords,
    storeSnapshot,
    takeDriveDirty,
    writeDriveBackupAt,
} from './local';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const LINK_KEY = 'lustre.drive.link';
const DAY_MS = 24 * 3_600_000;

interface DriveLink {
    refreshToken: string;
    account: string | null;
    /** Google stopped honouring the grant at this instant; nothing uploads until a new sign-in. */
    signedOutAt: string | null;
}

// Required here rather than imported, for the reason `./local` requires SQLite.
function secureStore(): typeof import('expo-secure-store') {
    return require('expo-secure-store') as typeof import('expo-secure-store');
}

function fetcher(): DriveFetch {
    // Not React Native's own: that one cannot send or read raw bytes.
    const { fetch } = require('expo/fetch') as { fetch: unknown };
    return fetch as DriveFetch;
}

/** Null on a build with no Google client, which offers none of this. */
export function driveClientId(): string | null {
    const id = (Constants.expoConfig?.extra as { driveClientId?: unknown } | undefined)?.driveClientId;
    return typeof id === 'string' && id ? id : null;
}

function readLink(): DriveLink | null {
    try {
        const raw = secureStore().getItem(LINK_KEY);
        return raw ? (JSON.parse(raw) as DriveLink) : null;
    } catch {
        // A keystore restored onto another phone cannot decrypt: sign in again.
        return null;
    }
}

async function writeLink(link: DriveLink | null): Promise<void> {
    if (link) await secureStore().setItemAsync(LINK_KEY, JSON.stringify(link));
    else await secureStore().deleteItemAsync(LINK_KEY);
    announce(link);
}

function announce(link: DriveLink | null): void {
    noteDriveLink(
        link
            ? { account: link.account, signedOutAt: link.signedOutAt ? new Date(link.signedOutAt) : null }
            : null,
    );
}

/** What Settings reads without waiting. Called on opening the clinic. */
export function hydrateDriveLink(): void {
    announce(readLink());
}

let access: { token: string; until: number; client: string } | null = null;

async function accessToken(): Promise<string> {
    const client = driveClientId();
    const link = readLink();
    if (!client || !link) throw new DriveError('signedOut', 'not linked');
    if (access && access.client === client && access.until > Date.now()) return access.token;

    const response = await fetcher()(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: client,
            grant_type: 'refresh_token',
            refresh_token: link.refreshToken,
        }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
    };
    if (body.error === 'invalid_grant') {
        await writeLink({ ...link, signedOutAt: new Date().toISOString() });
        throw new DriveError('signedOut', 'the grant was revoked');
    }
    if (!response.ok || !body.access_token) throw new DriveError('failed', `token: ${response.status}`);
    access = {
        token: body.access_token,
        client,
        until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    };
    return access.token;
}

/** A finished Google sign-in. The account is only for showing; failing to read it costs nothing. */
export async function linkDrive(refreshToken: string, token: string): Promise<void> {
    const account = await driveAccount(fetcher(), token).catch(() => null);
    access = null;
    await writeLink({ refreshToken, account, signedOutAt: null });
}

let running: Promise<Date> | null = null;

/** One at a time: the daily check and a tap can land together. */
function upload(): Promise<Date> {
    running ??= uploadNow().finally(() => {
        running = null;
    });
    return running;
}

async function uploadNow(): Promise<Date> {
    const at = new Date();
    const snapshot = storeSnapshot(at);
    // Taken with the snapshot, in one tick: a save during the upload marks it again.
    takeDriveDirty();
    try {
        const send = fetcher();
        const token = await accessToken();
        await uploadBackup(send, token, `lustre-clinic-${todayKey(at.getTime())}.db.gz`, snapshot);
        writeDriveBackupAt(at);
        // The new copy is safe whatever happens here; the next run tries again.
        try {
            const past = backupsPastKept(await listBackups(send, token));
            for (const old of past) await deleteBackup(send, token, old.id);
        } catch {}
        return at;
    } catch (error) {
        noteDriveDirty();
        if (error instanceof DriveError && error.kind === 'signedOut') {
            const link = readLink();
            if (link && !link.signedOutAt) await writeLink({ ...link, signedOutAt: at.toISOString() });
        }
        throw error;
    }
}

/** "Back up now": always uploads, since whoever asked may be about to uninstall. */
export function backUpToDrive(): Promise<Date> {
    return upload();
}

/** A day since the last one and something new to send. The first ever is always due. */
function isBackupDue(lastAt: Date | null, dirty: boolean, now: number = Date.now()): boolean {
    if (!lastAt) return true;
    return dirty && now - lastAt.getTime() >= DAY_MS;
}

/** The daily check, from the background task and from the app coming to the front. */
export async function backUpIfDue(): Promise<boolean> {
    const link = readLink();
    if (!driveClientId() || !link || link.signedOutAt) return false;
    // Signed in on a reinstall, with a new clinic not yet used or none at all: an
    // empty copy would become the newest, and the one a restore offers first.
    if (!storeHasRecords()) return false;
    const { lastBackupAt, dirty } = readDriveMeta();
    if (!isBackupDue(lastBackupAt, dirty)) return false;
    await upload();
    return true;
}

export async function listDriveBackups(): Promise<DriveBackup[]> {
    return listBackups(fetcher(), await accessToken());
}

/** Read and checked like a picked file, row by row, and not opened yet. */
export async function fetchDriveBackup(id: string): Promise<PickedClinic> {
    return pickedFromSnapshot(await downloadBackup(fetcher(), await accessToken(), id));
}

/** Every backup gone from Drive, and the phone stays linked. Stops at the first one that fails. */
export async function deleteDriveBackups(): Promise<void> {
    const send = fetcher();
    const token = await accessToken();
    for (const backup of await listBackups(send, token)) await deleteBackup(send, token, backup.id);
}

/**
 * Stops the backups and forgets the grant. The backups stay in Drive: after this
 * the app cannot reach them, so deleting them is offered first. A revoke that
 * fails still unlinks, because the person asked for this phone to stop.
 */
export async function unlinkDrive(): Promise<void> {
    const link = readLink();
    access = null;
    await writeLink(null);
    if (!link) return;
    await fetcher()(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: link.refreshToken }).toString(),
    }).catch(() => undefined);
}
