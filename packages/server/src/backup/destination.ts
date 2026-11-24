import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { createDriveClient, type DriveCredentials, normalizePrivateKey } from './drive.ts';
import { readDriveGrant } from './grant.ts';
import { type BackupFile, parseBackupFileName } from './retention.ts';

export interface OffsiteFile extends BackupFile {
    readonly handle: string;
}

export interface OffsiteDestination {
    readonly kind: 'drive' | 's3';
    upload(name: string, body: Uint8Array): Promise<string>;
    list(): Promise<OffsiteFile[]>;
    remove(handle: string): Promise<void>;
}

function toBackupName(name: string): string {
    return name.replace(/\.enc$/, '');
}

export function selectOffsiteDumps(entries: readonly { name: string; handle: string }[]): OffsiteFile[] {
    return entries.flatMap((entry) => {
        const at = parseBackupFileName(toBackupName(entry.name));
        return at ? [{ name: entry.name, at, handle: entry.handle }] : [];
    });
}

type DriveEnvironment = Pick<
    typeof config,
    | 'BACKUP_DRIVE_FOLDER_ID'
    | 'BACKUP_DRIVE_OAUTH_CLIENT_ID'
    | 'BACKUP_DRIVE_OAUTH_CLIENT_SECRET'
    | 'BACKUP_DRIVE_REFRESH_TOKEN'
    | 'BACKUP_DRIVE_CLIENT_EMAIL'
    | 'BACKUP_DRIVE_PRIVATE_KEY'
    | 'BACKUP_DRIVE_SUBJECT'
>;

export function resolveDriveCredentials(env: DriveEnvironment): {
    credentials: DriveCredentials | null;
    missing: string[];
} {
    const set = (value: string | undefined): string | undefined => value?.trim() || undefined;

    const oauth = {
        BACKUP_DRIVE_FOLDER_ID: set(env.BACKUP_DRIVE_FOLDER_ID),
        BACKUP_DRIVE_OAUTH_CLIENT_ID: set(env.BACKUP_DRIVE_OAUTH_CLIENT_ID),
        BACKUP_DRIVE_OAUTH_CLIENT_SECRET: set(env.BACKUP_DRIVE_OAUTH_CLIENT_SECRET),
        BACKUP_DRIVE_REFRESH_TOKEN: set(env.BACKUP_DRIVE_REFRESH_TOKEN),
    };
    const oauthConfigured = Boolean(
        oauth.BACKUP_DRIVE_OAUTH_CLIENT_ID ||
            oauth.BACKUP_DRIVE_OAUTH_CLIENT_SECRET ||
            oauth.BACKUP_DRIVE_REFRESH_TOKEN,
    );
    const oauthMissing = Object.entries(oauth)
        .filter(([, value]) => !value)
        .map(([name]) => name);

    if (oauthConfigured && oauthMissing.length === 0) {
        return {
            credentials: {
                kind: 'oauth',
                clientId: oauth.BACKUP_DRIVE_OAUTH_CLIENT_ID as string,
                clientSecret: oauth.BACKUP_DRIVE_OAUTH_CLIENT_SECRET as string,
                refreshToken: oauth.BACKUP_DRIVE_REFRESH_TOKEN as string,
                folderId: oauth.BACKUP_DRIVE_FOLDER_ID as string,
            },
            missing: [],
        };
    }

    const serviceAccount = {
        BACKUP_DRIVE_FOLDER_ID: oauth.BACKUP_DRIVE_FOLDER_ID,
        BACKUP_DRIVE_CLIENT_EMAIL: set(env.BACKUP_DRIVE_CLIENT_EMAIL),
        BACKUP_DRIVE_PRIVATE_KEY: set(env.BACKUP_DRIVE_PRIVATE_KEY),
    };
    const serviceAccountConfigured = Object.values(serviceAccount).some(Boolean);
    const serviceAccountMissing = Object.entries(serviceAccount)
        .filter(([, value]) => !value)
        .map(([name]) => name);

    if (!oauthConfigured && serviceAccountConfigured && serviceAccountMissing.length === 0) {
        return {
            credentials: {
                kind: 'service-account',
                clientEmail: serviceAccount.BACKUP_DRIVE_CLIENT_EMAIL as string,
                privateKey: normalizePrivateKey(serviceAccount.BACKUP_DRIVE_PRIVATE_KEY as string),
                folderId: serviceAccount.BACKUP_DRIVE_FOLDER_ID as string,
                subject: set(env.BACKUP_DRIVE_SUBJECT),
            },
            missing: [],
        };
    }

    if (oauthConfigured) return { credentials: null, missing: oauthMissing };
    if (serviceAccountConfigured) return { credentials: null, missing: serviceAccountMissing };
    return { credentials: null, missing: [] };
}

async function driveDestination(): Promise<OffsiteDestination | null> {
    const grant = await readDriveGrant();
    const resolved = grant
        ? {
              credentials: {
                  kind: 'oauth' as const,
                  clientId: grant.clientId,
                  refreshToken: grant.refreshToken,
                  folderId: grant.folderId,
              },
              missing: [],
          }
        : resolveDriveCredentials(config);

    if (!resolved.credentials) {
        if (resolved.missing.length > 0) {
            logger.warn(
                { missing: resolved.missing },
                'Google Drive backups are partially configured — the off-site copy is disabled',
            );
        }
        return null;
    }

    const client = createDriveClient({ credentials: resolved.credentials });

    return {
        kind: 'drive',
        upload: (name, body) => client.upload(name, body),
        async list() {
            const files = await client.list();
            return selectOffsiteDumps(files.map((file) => ({ name: file.name, handle: file.id })));
        },
        remove: (handle) => client.remove(handle),
    };
}

function s3Destination(): OffsiteDestination | null {
    if (!config.BACKUP_S3_BUCKET) return null;

    const client = new Bun.S3Client({
        bucket: config.BACKUP_S3_BUCKET,
        endpoint: config.BACKUP_S3_ENDPOINT,
        region: config.BACKUP_S3_REGION,
        accessKeyId: config.BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: config.BACKUP_S3_SECRET_ACCESS_KEY,
    });

    const prefix = `${config.BACKUP_S3_PREFIX}/`;

    return {
        kind: 's3',
        async upload(name, body) {
            const key = `${prefix}${name}`;
            await client.file(key).write(body);
            return key;
        },
        async list() {
            const listed = await client.list({ prefix });

            return selectOffsiteDumps(
                (listed.contents ?? []).map((entry) => ({
                    name: entry.key.slice(prefix.length),
                    handle: entry.key,
                })),
            );
        },
        remove: (handle) => client.delete(handle),
    };
}

export async function offsiteDestination(): Promise<OffsiteDestination | null> {
    return (await driveDestination()) ?? s3Destination();
}
