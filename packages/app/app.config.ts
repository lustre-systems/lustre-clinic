/**
 * `app.json` is the config. This adds the one part that depends on who the
 * release is built for: the clinic server a release APK asks for OTA updates
 * (§15, infra/README.md "Releases").
 *
 * `LUSTRE_UPDATES_URL` is that server's tailnet address. It is baked into the
 * APK because expo-updates reads it before any JavaScript runs, so it cannot
 * come from setup the way the API address does. Without it, and on a demo build
 * whatever it says, updates are off and the APK runs only its own bundle: a demo
 * that took a production update would turn into the clinic's app. Debug builds
 * load Metro and never ask.
 *
 * Launch never waits on the network (`fallbackToCacheTimeout: 0`): the app
 * starts on what it already has, and an update downloads in the background and
 * runs on the next cold start. A reload mid-screen would cost the secretary a
 * half-filled booking, and a clinic in a power cut would sit on the splash
 * screen.
 *
 * Manifests are signed at publish time with a key kept out of the repo and off
 * the server. `certs/certificate.pem` is its public half, and the phone refuses
 * an update that does not verify against it.
 *
 * `LUSTRE_VERSION` is the release's number, which `scripts/release.ts` works
 * out and passes in (infra/README.md "Versions"). It is never written into
 * app.json: a number bumped by hand is a number somebody forgets. Anything
 * built without it is `0.0.0`, which is how a dev build reads.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

// `UPDATES_MANIFEST_PATH` and `UPDATES_CHANNEL` from `@lustre/shared`, spelled
// out because Expo evaluates this file outside Metro. `app.config.test.ts`
// holds the two equal.
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
    // Thrown rather than passed on: Android would take any string as versionName.
    if (!SEMVER.test(trimmed)) throw new Error(`LUSTRE_VERSION must be MAJOR.MINOR.PATCH, got "${trimmed}"`);
    return trimmed;
}

/**
 * GlitchTip's DSN for crash reports (§17), from `LUSTRE_GLITCHTIP_DSN`. It
 * points at the clinic server's MagicDNS name and is baked in for the same
 * reason the updates URL is: a crash before setup still has to know where to
 * go. Empty turns reports off, which is every dev machine. A demo build never
 * gets one, because its crashes come from invented patients.
 */
export function glitchtipDsn(dsn: string | undefined, demo: boolean): string | null {
    const trimmed = dsn?.trim();
    return trimmed && !demo ? trimmed : null;
}

/**
 * Where a dev build looks for the server before anybody has configured one, from
 * `LUSTRE_DEV_SERVER`. `scripts/device.sh` and the two beside it set it to the
 * port the API actually binds, which they have already reversed onto the device,
 * so `localhost` there is the machine running `bun dev`.
 *
 * It is baked into every build and read by none but a dev one (`api/config.ts`):
 * `__DEV__` is false in a release bundle whatever this says, so the value rides
 * along in a clinic's APK as a string nothing looks at.
 *
 * It is hashed into the runtime fingerprint the way `LUSTRE_UPDATES_URL` and
 * `LUSTRE_GLITCHTIP_DSN` are, so a release is built without it set — which is
 * what `bun release:apk` does, since only the three device scripts export it.
 */
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
            // An Android OAuth client is tied to one package and signing key, so a
            // dev build and a release each bake in their own. Public: Google issues
            // no secret for one, and PKCE stands in.
            driveClientId: process.env.LUSTRE_DRIVE_CLIENT_ID?.trim() || null,
        },
    };
}
