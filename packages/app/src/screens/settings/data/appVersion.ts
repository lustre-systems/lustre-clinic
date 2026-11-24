import { type Locale, localizeCopy } from '@lustre/shared';
import type { RouterOutput } from '../../../api';
import { getLocale } from '../../../i18n/runtime';

type LatestApk = NonNullable<RouterOutput['release']['latestApk']>;

export interface InstalledVersion {
    version: string | null;
    apkVersion: string | null;
    build: string | null;
    updateId: string | null;
    updateCreatedAt: Date | null;
    embedded: boolean;
}

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

export function apkLabel(
    { apkVersion, build }: Pick<InstalledVersion, 'apkVersion' | 'build'>,
    locale: Locale = getLocale(),
): string {
    if (!apkVersion) return build ?? '—';
    return build
        ? localizeCopy(locale, '{version} · build {build}', { version: apkVersion, build })
        : apkVersion;
}

export function updateLabel(
    { updateId, updateCreatedAt, embedded }: InstalledVersion,
    locale: Locale = getLocale(),
): string {
    if (updateId === null) return localizeCopy(locale, 'Off in this build');
    if (embedded) return localizeCopy(locale, 'Built in');
    const day = updateCreatedAt ? ` · ${updateCreatedAt.toISOString().slice(0, 10)}` : '';
    return `${updateId.slice(0, 8)}${day}`;
}
