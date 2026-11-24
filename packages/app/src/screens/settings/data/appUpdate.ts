import { APK_PATH } from '@lustre/shared';
import { useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { BUILD_VARIANT, serverAddresses, useTRPC } from '../../../api';
import { type InstalledVersion, newerApk } from './appVersion';

export function installedVersion(): InstalledVersion {
    return {
        version: Constants.expoConfig?.version ?? null,
        apkVersion: Application.nativeApplicationVersion,
        build: Application.nativeBuildVersion,
        updateId: Updates.isEnabled ? Updates.updateId : null,
        updateCreatedAt: Updates.createdAt,
        embedded: Updates.isEmbeddedLaunch,
    };
}

export interface ApkUpdate {
    version: string;
    versionCode: number;
    url: string;
}

export function useApkUpdate(): ApkUpdate | null {
    const trpc = useTRPC();
    const prod = BUILD_VARIANT === 'prod';
    const latest = useQuery(
        trpc.release.latestApk.queryOptions(undefined, { enabled: prod, refetchInterval: 60 * 60_000 }),
    );

    const newer = prod ? newerApk(Application.nativeBuildVersion, latest.data, Updates.runtimeVersion) : null;
    const server = serverAddresses().tailscale;
    return newer && server ? { ...newer, url: `${server}${APK_PATH}` } : null;
}
