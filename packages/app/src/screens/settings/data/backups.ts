import { type CopyVars, dateKey, localizeCopy } from '@lustre/shared';
import { serverNow } from '../../../api/serverClock';

type Translate = (copy: string, vars?: CopyVars) => string;
const english: Translate = (copy, vars) => localizeCopy('en', copy, vars);

export interface BackupStatusData {
    lastSuccessAt: string | null;
    stale: boolean;
    staleAfterHours: number;
    offsite: {
        configured: boolean;
        reauthorizationRequiredSince: string | null;
        account: string | null;
        canSignIn: boolean;
    };
}

export type BackupTone = 'ok' | 'stale' | 'reauthorize';

export interface BackupView {
    tone: BackupTone;
    sub: string;
    detail: string | null;
    account: string | null;
    canSignIn: boolean;
    linked: boolean;
}

export function driveSignInError(code: string): string {
    if (code === 'DRIVE_SIGN_IN_UNCONFIGURED') return 'Drive sign-in is not set up on the clinic server';
    if (code === 'DRIVE_LINK_FAILED') return 'Google refused the sign-in — try again';
    return 'Could not link Google Drive';
}

function calendarDaysSince(since: string, now: number): number | null {
    if (Number.isNaN(new Date(since).getTime())) return null;
    const dayOf = (at: string | number) => Date.parse(`${dateKey(at)}T00:00:00Z`);
    return Math.max(0, Math.round((dayOf(now) - dayOf(since)) / 86_400_000));
}

export function ageInDays(since: string, now: number): number | null {
    const at = new Date(since).getTime();
    if (Number.isNaN(at)) return null;
    return Math.max(0, Math.floor((now - at) / 86_400_000));
}

function stoppedFor(days: number | null, t: Translate): string {
    if (days === null || days < 1) return t('The off-site copy has stopped.');
    if (days === 1) return t('The off-site copy has been stopped since yesterday.');
    return t('The off-site copy has been stopped for {days} days.', { days });
}

export function formatAge(days: number, t: Translate = english): string {
    if (days < 1) return t('today');
    if (days === 1) return t('yesterday');
    return t('{days} days ago', { days });
}

function lastLine(lastSuccessAt: string | null, now: number, t: Translate): string {
    if (!lastSuccessAt) return t('No backup yet');
    const days = ageInDays(lastSuccessAt, now);
    if (days === null) return t('No backup yet');
    return t('Last backup {age}', { age: formatAge(days, t) });
}

export function localBackupLine(
    status: BackupStatusData,
    now: number = Date.now(),
    t: Translate = english,
): string {
    if (status.offsite.reauthorizationRequiredSince) return t('Google Drive needs a new sign-in');
    if (!status.offsite.configured) return t('Backups are off');
    const days = status.lastSuccessAt ? ageInDays(status.lastSuccessAt, now) : null;
    if (days === null) return t('No backup yet');
    return t('Last backup {age}', { age: formatAge(days, t) });
}

export type LocalBackupWarning = 'off' | 'signedOut' | 'behind';

export function localBackupWarning(status: BackupStatusData): LocalBackupWarning | null {
    if (status.offsite.reauthorizationRequiredSince) return 'signedOut';
    if (!status.offsite.configured) return 'off';
    return status.stale ? 'behind' : null;
}

export function backupView(
    status: BackupStatusData,
    now: number = serverNow(),
    t: Translate = english,
): BackupView {
    const last = lastLine(status.lastSuccessAt, now, t);
    const since = status.offsite.reauthorizationRequiredSince;
    const link = {
        account: status.offsite.account,
        canSignIn: status.offsite.canSignIn,
        linked: status.offsite.configured && !since,
    };

    if (since) {
        return {
            tone: 'reauthorize',
            sub: t('Google Drive needs a new sign-in'),
            detail: signInHint(status.offsite.canSignIn, ageInDays(since, now), t),
            ...link,
        };
    }

    if (status.stale) return { tone: 'stale', sub: last, detail: null, ...link };

    return {
        tone: 'ok',
        sub: status.offsite.configured
            ? t('{last} · copied off-site', { last })
            : t('{last} · on this machine only', { last }),
        detail: null,
        ...link,
    };
}

function signInHint(canSignIn: boolean, days: number | null, t: Translate): string {
    const stopped = stoppedFor(days, t);
    return canSignIn
        ? t('{stopped} Open Backups below to sign in again.', { stopped })
        : t('{stopped} Ask whoever set up the clinic server to sign in to Google Drive again.', { stopped });
}

export type BackupDotTone = 'success' | 'due' | 'danger';

export interface BackupDetails {
    headline: string;
    dot: BackupDotTone;
    last: string;
    offsite: string;
    note: string | null;
}

export function backupDetails(
    status: BackupStatusData,
    now: number = serverNow(),
    t: Translate = english,
    clock: (at: number) => string = (at) => new Date(at).toISOString().slice(11, 16),
): BackupDetails {
    const view = backupView(status, now, t);
    const at = status.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : Number.NaN;
    const days = status.lastSuccessAt ? calendarDaysSince(status.lastSuccessAt, now) : null;
    const last =
        Number.isNaN(at) || days === null ? t('No backup yet') : `${clock(at)} · ${formatAge(days, t)}`;
    const offsite = status.offsite.configured
        ? (status.offsite.account ?? t('Google Drive'))
        : t('On this machine only');

    if (view.tone === 'reauthorize') {
        return { headline: view.sub, dot: 'danger', last, offsite, note: view.detail };
    }
    if (view.tone === 'stale') {
        return {
            headline: t('Backups are behind'),
            dot: 'due',
            last,
            offsite,
            note: t('No backup in over {hours}h.', { hours: status.staleAfterHours }),
        };
    }
    return { headline: t('Backups are up to date'), dot: 'success', last, offsite, note: null };
}
