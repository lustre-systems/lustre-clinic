/**
 * What `backup.status` means on the settings index (SPEC §16).
 *
 * Three states, and only one of them is loud. A revoked or expired Google grant
 * is the one the doctor has to be told about in words: the nightly dump still
 * runs and still verifies, so nothing on the phone looks wrong, while the only
 * copy that survives the clinic burning down stopped being written. Stale is
 * quieter — the §17 Discord alert already went out and the cause is usually a
 * machine that was off. Everything else is a sub-line nobody needs to read.
 *
 * The age is deliberately coarse. "3 days" is what decides whether this is
 * ignored until Monday; a minute count would be false precision on a number
 * that is only ever read to answer "how bad is it".
 *
 * Every sentence here is English copy with an Arabic entry behind it. The view
 * is built at render, so the screen passes its `t`; the tests, and anything
 * else with no locale in hand, get the English.
 */
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
    /** The settings row's sub — always present, like every other row's. */
    sub: string;
    /** The card's second line, or null when there is no card to draw. */
    detail: string | null;
    /** The account the clinic backs up to, for the confirm sheet to name. */
    account: string | null;
    /** The server has an Android client, so the row can open the sign-in. */
    canSignIn: boolean;
    /** Drive holds a working grant, so there is nothing to sign in to. */
    linked: boolean;
}

/**
 * §14 — the client localizes from `ERROR_CODE` and never by reading the
 * server's message, which stays English for the logs.
 */
export function driveSignInError(code: string): string {
    if (code === 'DRIVE_SIGN_IN_UNCONFIGURED') return 'Drive sign-in is not set up on the clinic server';
    if (code === 'DRIVE_LINK_FAILED') return 'Google refused the sign-in — try again';
    return 'Could not link Google Drive';
}

/**
 * Calendar days on the clinic's clock rather than 24-hour spans: the pane puts
 * the age beside a clock time, and "11:00 PM · today" read at 1 AM is wrong.
 */
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

/** A duration, not a date: "2 days ago" is when it broke, which is not the question. */
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

    // No card: stale already has a §17 Discord alert behind it and the row says
    // so itself. The card is for the failure that has no other signal.
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

/**
 * The card tells the reader what *they* can do about it, which depends on
 * whether this server can run the sign-in from the handset at all.
 */
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
    /** "3:00 AM · yesterday", or that there has never been one. */
    last: string;
    /** Where the off-site copy goes: the Drive account, or nowhere. */
    offsite: string;
    /** What is wrong, when something is; null when nothing is. */
    note: string | null;
}

/**
 * The Backups pane: the index row's answer with the clock time put back, and
 * the account named. Built from the same status as the row, so the two cannot
 * disagree about which of the three states the clinic is in.
 */
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
