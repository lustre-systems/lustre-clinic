/**
 * What Settings reports about local mode's backups. `./local` and `./localDrive`
 * keep it on file and set it here; it lives apart from them so `handlers/backup`
 * reads it without bringing the file system along.
 */
export interface DriveLinkState {
    account: string | null;
    signedOutAt: Date | null;
}

let driveLink: DriveLinkState | null = null;
let driveBackupAt: Date | null = null;

/** Null when this phone is not linked to Drive. */
export function currentDriveLink(): DriveLinkState | null {
    return driveLink;
}

export function noteDriveLink(next: DriveLinkState | null): void {
    driveLink = next;
}

export function lastDriveBackupAt(): Date | null {
    return driveBackupAt;
}

export function noteLastDriveBackupAt(next: Date | null): void {
    driveBackupAt = next;
}

let driveUnsaved = false;

/** The clinic holds something no backup has. */
export function hasDriveUnsaved(): boolean {
    return driveUnsaved;
}

export function noteDriveUnsaved(next: boolean): void {
    driveUnsaved = next;
}
