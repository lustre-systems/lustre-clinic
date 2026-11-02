/**
 * The clinic server, in memory, on the phone: the demo's invented clinic, or
 * local mode's real one (`./local`).
 *
 * `../client` splits on `deviceBackend()` per request, so nothing else in the
 * app knows this exists — the screens call the same procedures over the same
 * client and get the same shapes back.
 */

export { BACKUPS_KEPT, DRIVE_SCOPE, type DriveBackup, DriveError } from './drive';
export { subscribeToDemoEvents } from './events';
export {
    deviceBackend,
    disableDemoMode,
    disableLocalMode,
    enableDemoMode,
    isDemoMode,
    isLocalMode,
    useDemoMode,
    useDeviceBackend,
} from './flag';
export { demoLink } from './link';
export type { PickedClinic } from './local';
export {
    backUpIfDue,
    backUpToDrive,
    deleteDriveBackups,
    driveClientId,
    fetchDriveBackup,
    hydrateDriveLink,
    linkDrive,
    listDriveBackups,
    unlinkDrive,
} from './localDrive';
export { LocalStoreError } from './localFormat';

import type { Role } from '@lustre/shared';
import { credentialToken, forgetDemoCredential, grantCredential, hydrateCredential } from '../credential';
import { noteClinicReplaced, noteDataReset } from '../dataReset';
import { clearStored, getDb, setDb, takeDirty } from './db';
import { disableLocalMode, enableLocalMode } from './flag';
import { provisionDemo } from './handlers/device';
import { openDeviceDb } from './link';
import { commitLocal, openClinicFile, type PickedClinic, takeDriveDirty } from './local';
import { hydrateDriveLink } from './localDrive';
import { seedDemoDb } from './seed';

/**
 * Runs the clinic on this phone alone. The phone is its only device, so it is
 * made the admin: it books, takes payments and sets the clinic up. Entering
 * again finds the clinic and the phone's role where they were left.
 */
export async function startLocalMode(): Promise<void> {
    await enableLocalMode();
    try {
        await hydrateCredential();
        await openDeviceDb('local');
        hydrateDriveLink();
        const token = credentialToken();
        const known = getDb().devices.some((device) => device.token === token && !device.revokedAt);
        if (known) return;
        const credential = provisionDemo('admin', token, 'This phone');
        if (takeDirty()) commitLocal();
        grantCredential(credential);
    } catch (error) {
        await disableLocalMode();
        throw error;
    }
}

/**
 * Local mode on a clinic brought back from a backup: another phone's, or this
 * one's from before it was reset. The phone is made its admin the
 * way `startLocalMode` makes it the admin of any clinic it has not seen.
 */
export async function startLocalModeFrom(picked: PickedClinic): Promise<void> {
    openClinicFile(picked);
    await startLocalMode();
    // Registering this phone wrote a row, which is no reason to upload the clinic
    // that just came out of Drive straight back into it.
    if (picked.exportedAt) takeDriveDirty();
    noteClinicReplaced();
}

/**
 * Back to the clinic the demo opens on. Worth having on the settings screen:
 * a demo is given more than once, and the second run should not start on the
 * first one's cancellations.
 */
export async function resetDemoData(): Promise<void> {
    await clearStored();
    setDb(seedDemoDb());
    forgetDemoCredential();
    noteDataReset();
}

/**
 * Becomes `role` inside the demo, which has no second phone to hand this one a
 * code. The role still lives on a demo device row and every demo request is
 * checked against it, as the server checks the real one.
 */
export async function becomeInDemo(role: Role): Promise<void> {
    await openDeviceDb('demo');
    grantCredential(provisionDemo(role, credentialToken()));
}
