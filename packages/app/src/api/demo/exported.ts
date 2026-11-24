export interface DriveLinkState {
    account: string | null;
    signedOutAt: Date | null;
}

let driveLink: DriveLinkState | null = null;
let driveBackupAt: Date | null = null;

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

export function hasDriveUnsaved(): boolean {
    return driveUnsaved;
}

export function noteDriveUnsaved(next: boolean): void {
    driveUnsaved = next;
}
