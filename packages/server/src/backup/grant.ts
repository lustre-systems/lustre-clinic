import { chmod, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';

const GRANT_FILE = 'drive-grant.json';

export interface DriveGrant {
    clientId: string;
    refreshToken: string;
    folderId: string;
    account?: string;
    linkedAt: string;
}

export async function readDriveGrant(directory = config.BACKUP_DIR): Promise<DriveGrant | null> {
    try {
        const grant = (await Bun.file(join(directory, GRANT_FILE)).json()) as DriveGrant;
        return grant.clientId && grant.refreshToken && grant.folderId ? grant : null;
    } catch {
        return null;
    }
}

export async function writeDriveGrant(grant: DriveGrant, directory = config.BACKUP_DIR): Promise<void> {
    const target = join(directory, GRANT_FILE);
    const scratch = `${target}.${process.pid}.tmp`;
    await Bun.write(scratch, JSON.stringify(grant, null, 2));
    await chmod(scratch, 0o600);
    await rename(scratch, target);
}

export async function clearDriveGrant(directory = config.BACKUP_DIR): Promise<void> {
    await unlink(join(directory, GRANT_FILE)).catch(() => {});
}
