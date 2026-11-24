import type { ConfigContext, ExpoConfig } from 'expo/config';

export const MANIFEST_PATH = '/updates/manifest';
export const CHANNEL = 'production';
export const DEV_CHANNEL = 'development';

export function releaseTrack(value: string | undefined): 'production' | 'development' {
    if (!value || value === 'production') return 'production';
    if (value === 'development') return 'development';
    throw new Error(`LUSTRE_RELEASE_TRACK must be production or development, got "${value}"`);
}

export function updatesConfig(
    updatesUrl: string | undefined,
    demo: boolean,
    track: 'production' | 'development' = 'production',
): ExpoConfig['updates'] {
    const base = updatesUrl?.trim().replace(/\/+$/, '');
    if (!base || demo) return { enabled: false };

    return {
        enabled: true,
        url: `${base}${MANIFEST_PATH}`,
        checkAutomatically: 'ON_LOAD',
        fallbackToCacheTimeout: 0,
        requestHeaders: { 'expo-channel-name': track === 'production' ? CHANNEL : DEV_CHANNEL },
        codeSigningCertificate: './certs/certificate.pem',
        codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
    };
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseVersion(version: string | undefined, fallback: string | undefined): string {
    const trimmed = version?.trim();
    if (!trimmed) return fallback ?? '0.0.0';
    if (!SEMVER.test(trimmed)) throw new Error(`LUSTRE_VERSION must be MAJOR.MINOR.PATCH, got "${trimmed}"`);
    return trimmed;
}

export function glitchtipDsn(dsn: string | undefined, demo: boolean): string | null {
    const trimmed = dsn?.trim();
    return trimmed && !demo ? trimmed : null;
}

export const DEV_SERVER = 'http://localhost:3000';

export function devServer(address: string | undefined): string {
    return address?.trim().replace(/\/+$/, '') || DEV_SERVER;
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
    const demo = config.extra?.demo === true;
    const track = releaseTrack(process.env.LUSTRE_RELEASE_TRACK);
    const updatesUrl = process.env.LUSTRE_UPDATES_URL?.trim().replace(/\/+$/, '');
    return {
        ...config,
        name: track === 'development' ? 'Lustre DEV' : (config.name ?? 'Lustre Clinic'),
        slug: config.slug ?? 'lustre-clinic',
        version: releaseVersion(process.env.LUSTRE_VERSION, config.version),
        updates: updatesConfig(updatesUrl, demo, track),
        extra: {
            ...config.extra,
            ...(track === 'development' ? { server: { lan: null, tailscale: updatesUrl || null } } : {}),
            glitchtipDsn: glitchtipDsn(process.env.LUSTRE_GLITCHTIP_DSN, demo || track === 'development'),
            devServer: track === 'development' ? null : devServer(process.env.LUSTRE_DEV_SERVER),
            driveClientId: process.env.LUSTRE_DRIVE_CLIENT_ID?.trim() || null,
        },
    };
}
