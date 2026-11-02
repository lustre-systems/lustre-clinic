/**
 * `server/src/modules/backup`. A demo is the phone talking to itself, so there
 * is no backup job and nothing to be stale about: it answers as a clinic whose
 * last night went fine, which is what the Settings row should look like when
 * nobody is being shown a problem.
 *
 * Local mode's clinic is real, so it is told the truth instead. Its backups are
 * the ones `../localDrive` uploads: off until a Google account is linked, and
 * behind only with something unsaved two days on. An unchanged clinic uploads
 * nothing, so an old backup of it is not a problem.
 *
 * Signing in is refused rather than faked. There is no clinic server to hold a
 * refresh token, and a demo that appeared to link a real Google account would
 * be lying about where the dumps go.
 */
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
            // Never backed up is behind once there is something to lose: a first
            // upload that keeps failing must not read as nothing to report.
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
