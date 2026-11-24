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

export async function startLocalModeFrom(picked: PickedClinic): Promise<void> {
    openClinicFile(picked);
    await startLocalMode();
    if (picked.exportedAt) takeDriveDirty();
    noteClinicReplaced();
}

export async function resetDemoData(): Promise<void> {
    await clearStored();
    setDb(seedDemoDb());
    forgetDemoCredential();
    noteDataReset();
}

export async function becomeInDemo(role: Role): Promise<void> {
    await openDeviceDb('demo');
    grantCredential(provisionDemo(role, credentialToken()));
}
