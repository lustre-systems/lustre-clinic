/**
 * Google Drive's REST API, as much of it as local mode's backups use. Everything
 * lives in the account's hidden app folder (`appDataFolder`): nobody can browse,
 * move or share these files, and only this app's Google project can read them.
 * The price is that restoring happens in this app or not at all.
 *
 * No native code in here and `fetch` is passed in, so `bun test` reaches it.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const BACKUPS_KEPT = 14;

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
const ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const BACKUP_NAME = /^lustre-clinic-.*\.db\.gz$/;
const BOUNDARY = 'lustre-clinic-backup';

export type DriveFetch = (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array | string },
) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** `signedOut` is Google no longer honouring the grant; everything else may pass by itself. */
export class DriveError extends Error {
    constructor(
        readonly kind: 'signedOut' | 'failed',
        message: string,
    ) {
        super(message);
    }
}

export interface DriveBackup {
    id: string;
    name: string;
    createdAt: string;
    bytes: number;
}

async function checked(
    response: Awaited<ReturnType<DriveFetch>>,
    what: string,
): Promise<Awaited<ReturnType<DriveFetch>>> {
    if (response.ok) return response;
    throw new DriveError(response.status === 401 ? 'signedOut' : 'failed', `${what}: ${response.status}`);
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function driveAccount(fetcher: DriveFetch, token: string): Promise<string | null> {
    const response = await checked(await fetcher(ABOUT, { headers: bearer(token) }), 'about');
    const about = (await response.json()) as { user?: { emailAddress?: string } };
    return about.user?.emailAddress ?? null;
}

/** Newest first. Only this app's own files, should anything else ever sit in the folder. */
export async function listBackups(fetcher: DriveFetch, token: string): Promise<DriveBackup[]> {
    const backups: DriveBackup[] = [];
    let page: string | undefined;
    do {
        const query = new URLSearchParams({
            spaces: 'appDataFolder',
            orderBy: 'createdTime desc',
            pageSize: '100',
            fields: 'nextPageToken,files(id,name,createdTime,size)',
            ...(page ? { pageToken: page } : {}),
        });
        const response = await checked(
            await fetcher(`${FILES}?${query.toString()}`, { headers: bearer(token) }),
            'list',
        );
        const body = (await response.json()) as {
            nextPageToken?: string;
            files?: { id: string; name: string; createdTime: string; size?: string }[];
        };
        for (const file of body.files ?? []) {
            if (!BACKUP_NAME.test(file.name)) continue;
            backups.push({
                id: file.id,
                name: file.name,
                createdAt: file.createdTime,
                bytes: Number(file.size ?? 0),
            });
        }
        page = body.nextPageToken;
    } while (page);
    return backups;
}

export async function uploadBackup(
    fetcher: DriveFetch,
    token: string,
    name: string,
    bytes: Uint8Array,
): Promise<void> {
    const encoder = new TextEncoder();
    const head = encoder.encode(
        `--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n` +
            `--${BOUNDARY}\r\nContent-Type: application/gzip\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${BOUNDARY}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    await checked(
        await fetcher(UPLOAD, {
            method: 'POST',
            headers: { ...bearer(token), 'Content-Type': `multipart/related; boundary=${BOUNDARY}` },
            body,
        }),
        'upload',
    );
}

export async function downloadBackup(fetcher: DriveFetch, token: string, id: string): Promise<Uint8Array> {
    const response = await checked(
        await fetcher(`${FILES}/${encodeURIComponent(id)}?alt=media`, { headers: bearer(token) }),
        'download',
    );
    return new Uint8Array(await response.arrayBuffer());
}

export async function deleteBackup(fetcher: DriveFetch, token: string, id: string): Promise<void> {
    await checked(
        await fetcher(`${FILES}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: bearer(token) }),
        'delete',
    );
}

/** What falls out of the last `BACKUPS_KEPT`, given a list that is newest first. */
export function backupsPastKept(newestFirst: readonly DriveBackup[]): readonly DriveBackup[] {
    return newestFirst.slice(BACKUPS_KEPT);
}
