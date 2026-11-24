import { ERROR_CODE } from '@lustre/shared';
import type { RouterOutput } from '../../types';
import { getDb, openKind } from '../db';
import { currentDriveLink, hasDriveUnsaved, lastDriveBackupAt } from '../exported';
import { DemoError } from '../rules';
import type { Dated } from '../wire';

const DRIVE_STALE_AFTER_HOURS = 48;

export const backupHandlers = {
    status(): Dated<RouterOutput['backup']['status']> {
        if (openKind() === 'local') {
            const link = currentDriveLink();
            const last = lastDriveBackupAt();
            const { patients, appointments } = getDb();
            const old = last
                ? Date.now() - last.getTime() > DRIVE_STALE_AFTER_HOURS * 3_600_000
                : patients.length > 0 || appointments.length > 0;
            return {
                lastSuccessAt: last?.toISOString() ?? null,
                stale: !link || (hasDriveUnsaved() && old),
                staleAfterHours: DRIVE_STALE_AFTER_HOURS,
                offsite: {
                    configured: link !== null,
                    reauthorizationRequiredSince: link?.signedOutAt?.toISOString() ?? null,
                    account: link?.account ?? null,
                    canSignIn: false,
                },
            };
        }
        return {
            lastSuccessAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
            stale: false,
            staleAfterHours: 48,
            offsite: {
                configured: true,
                reauthorizationRequiredSince: null,
                account: 'demo@example.com',
                canSignIn: false,
            },
        };
    },

    signInConfig(): Dated<RouterOutput['backup']['signInConfig']> {
        throw new DemoError(ERROR_CODE.DRIVE_SIGN_IN_UNCONFIGURED, 'the demo has no clinic server');
    },

    linkDrive(): Dated<RouterOutput['backup']['linkDrive']> {
        throw new DemoError(ERROR_CODE.DRIVE_SIGN_IN_UNCONFIGURED, 'the demo has no clinic server');
    },
};
