/**
 * Which build this phone runs, in the words the doctor reads out over the
 * phone, and whether the clinic server has a newer APK than that (§15). Pure, so
 * `bun test` reaches it; `appUpdate.ts` supplies the native values.
 */
import { type Locale, localizeCopy } from '@lustre/shared';
import type { RouterOutput } from '../../../api';
import { getLocale } from '../../../i18n/runtime';

type LatestApk = NonNullable<RouterOutput['release']['latestApk']>;

export interface InstalledVersion {
    /** The release this launch runs: the update's number, or the APK's when it runs its own bundle. */
    version: string | null;
    /** `versionName` of the installed APK: `X.Y.0`, or the patch it was rebuilt with (`--with-apk`). An OTA update does not change it. */
    apkVersion: string | null;
    /** The APK's versionCode. */
    build: string | null;
    /** Null when updates are off: a dev, demo or local build. */
    updateId: string | null;
    updateCreatedAt: Date | null;
    embedded: boolean;
}

/**
 * The server's APK when it is newer than this install, otherwise null. An
 * install that cannot say its own build number is not offered one, or the
 * banner would never go away.
 *
 * An APK on this phone's own runtime brings nothing an OTA update has not: the
 * phone takes every update for that runtime, and the APK's own bundle is
 * usually older than the update it runs (an update rebuilds the APK only with
 * `bun ship --with-apk`). Only an APK with other native code is offered. A
 * server that does not say its APK's runtime, or a phone that cannot say its
 * own, falls back to the build number.
 */
export function newerApk(
    installedBuild: string | null,
    latest: LatestApk | null | undefined,
    installedRuntime: string | null = null,
): LatestApk | null {
    if (!latest || installedBuild === null) return null;
    const installed = Number(installedBuild);
    if (!Number.isSafeInteger(installed) || installed <= 0) return null;
    if (latest.versionCode <= installed) return null;
    if (installedRuntime && latest.runtimeVersion === installedRuntime) return null;
    return latest;
}

export function versionLine(
    { version, build }: Pick<InstalledVersion, 'version' | 'build'>,
    locale: Locale = getLocale(),
): string {
    const vars = { version: version ?? '0.0.0', build: build ?? '' };
    return localizeCopy(locale, build ? 'Lustre {version} (build {build})' : 'Lustre {version}', vars);
}

/** The installed APK, which an update runs on top of. */
export function apkLabel(
    { apkVersion, build }: Pick<InstalledVersion, 'apkVersion' | 'build'>,
    locale: Locale = getLocale(),
): string {
    if (!apkVersion) return build ?? '—';
    return build
        ? localizeCopy(locale, '{version} · build {build}', { version: apkVersion, build })
        : apkVersion;
}

/** The JavaScript this launch runs: the bundle in the APK, or an update by its short id and day. */
export function updateLabel(
    { updateId, updateCreatedAt, embedded }: InstalledVersion,
    locale: Locale = getLocale(),
): string {
    if (updateId === null) return localizeCopy(locale, 'Off in this build');
    if (embedded) return localizeCopy(locale, 'Built in');
    const day = updateCreatedAt ? ` · ${updateCreatedAt.toISOString().slice(0, 10)}` : '';
    return `${updateId.slice(0, 8)}${day}`;
}
