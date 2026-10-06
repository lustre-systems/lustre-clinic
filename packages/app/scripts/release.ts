/**
 * Stages a release for the clinic server (§15, infra/README.md "Releases").
 * Run by `bun ship` (scripts/ship.ts), not by hand.
 *
 *   release.ts apk [--major]    prebuild, build and sign the release APK
 *   release.ts update [--minor] [--screen] [--with-apk]
 *                               export the JavaScript and sign it as an OTA update.
 *                               A patch applies quietly on the next launch; --minor
 *                               makes phones stop, download it and restart now.
 *                               --with-apk also rebuilds the APK with it, so a fresh
 *                               install starts on it rather than taking it on first launch.
 *
 * Both write into `dist/releases` (or LUSTRE_RELEASES_DIR) in the layout
 * `server/src/modules/release` serves. Neither touches a server:
 * `scripts/pushReleases.ts` copies the directory to the clinic.
 *
 * Both need LUSTRE_UPDATES_URL, the clinic server's tailnet address; the dev
 * track needs LUSTRE_DEV_UPDATES_URL, the dev stack's, and uses it in its place. The APK
 * bakes it in and an update's asset URLs point at it. Build and publish with the
 * same value from the same app.json, or the runtime versions differ and no phone
 * takes the update.
 *
 * A production APK also needs LUSTRE_GLITCHTIP_DSN: it is baked in the same way,
 * and an APK built without it reports no crashes for as long as it is installed.
 *
 * Both number the release (`releaseVersion.ts`): an APK is the next minor, an
 * update the next patch on the APK its runtime belongs to. An APK rebuilt with
 * an update (--with-apk) carries the update's number, `X.Y.Z`, on the same
 * runtime; otherwise the staged APK keeps its own, older number. Both refuse a working
 * tree with uncommitted changes, and both tag the commit they were built from
 * `vX.Y.Z`, so a number always names code that can be checked out again.
 *
 *   bun packages/app/scripts/release.ts next apk|update [--major|--minor]
 *
 * prints the number the same command would release, and builds nothing.
 * `scripts/ship.ts` cuts the changelog with it, then passes it back as
 * LUSTRE_EXPECT_VERSION, and a release that works out another number stops.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { $ } from 'bun';
import {
    formatVersion,
    nextApkVersion,
    nextUpdateVersion,
    parseVersion,
    tagFor,
    type Version,
} from './releaseVersion';
import { type ExportedFile, manifestFor, signManifest } from './updateManifest';

const APP_DIR = resolve(import.meta.dir, '..');
const TRACK = process.env.LUSTRE_RELEASE_TRACK ?? 'production';
if (TRACK !== 'production' && TRACK !== 'development') {
    throw new Error('LUSTRE_RELEASE_TRACK must be production or development');
}
const DEV = TRACK === 'development';
// A dev build bakes this address in twice: where it asks for OTA updates, and
// the server it opens on (`app.config.ts`). It is the dev stack's, never the
// clinic's — a dev phone on the clinic server writes to real patients' records
// from half-finished code. Everything below and every build it runs reads
// LUSTRE_UPDATES_URL, so the dev track swaps its own value in here, once.
if (DEV) {
    const devUrl = process.env.LUSTRE_DEV_UPDATES_URL?.trim().replace(/\/+$/, '');
    if (!devUrl) {
        fail(
            'set LUSTRE_DEV_UPDATES_URL to the dev stack, scheme and port included, e.g. http://smilemakers.tailad17f9.ts.net:3001. A dev build never takes the clinic server.',
        );
    }
    if (devUrl === process.env.LUSTRE_UPDATES_URL?.trim().replace(/\/+$/, '')) {
        fail(
            `LUSTRE_DEV_UPDATES_URL is ${devUrl}, the clinic server. Point it at the dev stack (port 3001).`,
        );
    }
    process.env.LUSTRE_UPDATES_URL = devUrl;
}
const OUT_DIR = resolve(
    process.env.LUSTRE_RELEASES_DIR ?? join(APP_DIR, DEV ? '../../dist/releases-dev' : '../../dist/releases'),
);
const BUILD_TYPE = DEV ? 'devRelease' : 'release';
const APK_OUTPUTS = join(APP_DIR, `android/app/build/outputs/apk/${BUILD_TYPE}`);
// The release keystore's certificate (infra/README.md, Release signing). A phone
// installs an APK over the clinic app only when it carries this certificate, and
// a new keystore means an uninstall on every phone, so changing this is deliberate.
const RELEASE_CERT_SHA256 = 'a1fedfaa3ebc517c829c680a41419669079bf6d5b6a340334efc8dfe57245ecc';
const DEV_CERT_SHA256 = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';

interface ExportMetadata {
    fileMetadata?: { android?: { bundle: string; assets: { path: string; ext: string }[] } };
}

interface ApkOutputMetadata {
    applicationId?: string;
    elements?: { versionCode?: number; versionName?: string; outputFile?: string }[];
}

/** What the clinic's APK installs as. A dev build takes a suffix (`plugins/withDevIdentity.js`). */
const APPLICATION_ID = DEV ? 'com.lustre.clinic.dev' : 'com.lustre.clinic';

function say(line: string): void {
    process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
    process.stderr.write(`release: ${line}\n`);
    process.exit(1);
}

function updatesUrl(): string {
    const url = process.env.LUSTRE_UPDATES_URL?.trim().replace(/\/+$/, '');
    if (!url || !/^https?:\/\/[^/]+$/.test(url)) {
        fail(
            'set LUSTRE_UPDATES_URL to the clinic server, scheme and port included, e.g. http://smilemakers.tailad17f9.ts.net:3000. An APK built without it can never take an OTA update.',
        );
    }
    return url;
}

/** True when `app.json` marks this a demo build, whose crashes come from invented patients. */
async function isDemoBuild(): Promise<boolean> {
    const appJson = JSON.parse(await readFile(join(APP_DIR, 'app.json'), 'utf8')) as {
        expo?: { extra?: { demo?: unknown } };
    };
    return appJson.expo?.extra?.demo === true;
}

/**
 * The GlitchTip DSN baked into a production APK (§17), from `LUSTRE_GLITCHTIP_DSN`.
 *
 * `app.config.ts` nulls it for a dev or demo build on purpose, so only the
 * production track is checked. Unset there means an APK whose SDK never
 * initialises (`src/reporting/options.ts`) and a server that waits for events
 * no phone sends, with nothing to see until you need a crash report — so a
 * production build without reporting has to be deliberate, not the default.
 */
async function glitchtipDsn(updates: string): Promise<string | null> {
    if (DEV || (await isDemoBuild())) return null;

    const dsn = process.env.LUSTRE_GLITCHTIP_DSN?.trim();
    if (!dsn || !/^https?:\/\/[^:@/\s]+@[^/\s]+\/\d+$/.test(dsn)) {
        fail(
            "set LUSTRE_GLITCHTIP_DSN to the clinic GlitchTip project's DSN, e.g. http://<key>@smilemakers.tailad17f9.ts.net:8000/1 (GlitchTip UI, Settings -> Client Keys). It is baked in at build time, so an APK built without it reports no crashes and no OTA update can add one.",
        );
    }
    // The DSN is read on the phone, so loopback names the phone, not the clinic server.
    // `URL` lowercases the host and canonicalises IP forms (`127.1`, `[0:0::1]`), so one check covers them.
    const host = new URL(dsn).hostname;
    if (host === 'localhost' || host.startsWith('127.') || host === '[::1]') {
        fail(
            `LUSTRE_GLITCHTIP_DSN points at ${dsn.slice(dsn.indexOf('@') + 1)}. Use the server's MagicDNS name: no phone can reach loopback.`,
        );
    }
    // GlitchTip runs beside the API on the clinic server, so anything else — `0.0.0.0`,
    // another machine — is a DSN copied from somewhere it does not belong.
    const clinic = new URL(updates).hostname;
    if (host !== clinic) {
        fail(
            `LUSTRE_GLITCHTIP_DSN points at ${host}, but LUSTRE_UPDATES_URL is ${clinic}. Both are the clinic server.`,
        );
    }
    return dsn;
}

/** The environment first, then `~/.gradle/gradle.properties`, the same places Gradle reads the keystore from. */
async function gradleProperty(name: string): Promise<string | undefined> {
    const fromEnv = process.env[name] ?? process.env[`ORG_GRADLE_PROJECT_${name}`];
    if (fromEnv) return fromEnv;

    const home = process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle');
    const text = await readFile(join(home, 'gradle.properties'), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
        const match = line.match(/^\s*([^#!=:\s]+)\s*[=:]\s*(.*)$/);
        if (match?.[1] === name) return match[2]?.trim();
    }
    return undefined;
}

/** Written beside the target and renamed over it, so the server never reads half a file. */
async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, contents);
    await rename(temporary, path);
}

async function assertCleanTree(): Promise<void> {
    const changes = await $`git status --porcelain`.cwd(APP_DIR).quiet().text();
    if (changes.trim()) {
        fail(
            `the working tree has uncommitted changes. Commit or stash them first, so the release's tag names the code it was built from:\n${changes}`,
        );
    }
}

/** Every `vX.Y.Z` tag in the repository. */
async function taggedVersions(): Promise<string[]> {
    const prefix = DEV ? 'dev-v' : 'v';
    const tags = await $`git tag --list ${`${prefix}*`}`.cwd(APP_DIR).quiet().text();
    return tags
        .split('\n')
        .filter((tag) => tag.startsWith(prefix) && parseVersion(tag.slice(prefix.length)) !== null)
        .map((tag) => tag.slice(prefix.length));
}

async function headCommit(): Promise<string> {
    return (await $`git rev-parse HEAD`.cwd(APP_DIR).quiet().text()).trim();
}

async function tagRelease(version: Version, message: string): Promise<void> {
    const tag = `${DEV ? 'dev-' : ''}${tagFor(version)}`;
    await $`git tag --annotate ${tag} --message ${message}`.cwd(APP_DIR);
    say(`Tagged ${tag}.`);
}

interface StagedApk {
    versionCode?: number;
    version?: string;
    runtimeVersion?: string;
}

async function stagedApk(): Promise<StagedApk | null> {
    return JSON.parse(
        await readFile(join(OUT_DIR, 'android/latest.json'), 'utf8').catch(() => 'null'),
    ) as StagedApk | null;
}

/** The release number of every update already staged for `runtimeVersion`. */
async function publishedUpdateVersions(runtimeVersion: string): Promise<(string | undefined)[]> {
    const dir = join(OUT_DIR, 'updates', runtimeVersion);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return Promise.all(
        entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
                const manifest = JSON.parse(
                    await readFile(join(dir, entry.name, 'manifest.json'), 'utf8').catch(() => 'null'),
                ) as { metadata?: { version?: string } } | null;
                return manifest?.metadata?.version;
            }),
    );
}

async function resolvedRuntimeVersion(): Promise<string> {
    const output = await $`bunx expo-updates runtimeversion:resolve --platform android`
        .cwd(APP_DIR)
        .quiet()
        .text();
    const parsed = JSON.parse(output.slice(output.indexOf('{'))) as { runtimeVersion?: unknown };
    if (typeof parsed.runtimeVersion !== 'string') fail(`could not resolve the runtime version:\n${output}`);
    return parsed.runtimeVersion;
}

async function assertApkKey(apk: string): Promise<void> {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '/opt/android-sdk';
    const versions = await readdir(join(sdk, 'build-tools')).catch(() => []);
    const latest = versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
    if (!latest) fail(`no Android build-tools under ${sdk} to check the APK's signature with`);

    const certs = await $`${join(sdk, 'build-tools', latest, 'apksigner')} verify --print-certs ${apk}`
        .quiet()
        .text();
    const digest = certs.match(/certificate SHA-256 digest: ([0-9a-f]{64})/)?.[1];
    if (DEV) {
        if (digest !== DEV_CERT_SHA256) fail(`${apk} is not signed with the existing dev app's key`);
        return;
    }
    if (certs.includes('CN=Android Debug')) fail(`${apk} is signed with the debug key`);
    if (digest !== RELEASE_CERT_SHA256) {
        fail(
            `${apk} is signed with certificate ${digest ?? '(none found)'}, not the Lustre release key ${RELEASE_CERT_SHA256}. Phones on the current APK could not install it.`,
        );
    }
    say(certs.split('\n').find((line) => line.includes('certificate DN')) ?? certs);
}

interface BuiltApk {
    bytes: Uint8Array;
    versionCode: number;
    version: string;
    runtimeVersion: string;
    abis: string;
}

/** Prebuilds, builds and checks the release APK numbered `version`. Stages nothing. */
async function buildApk(version: string): Promise<BuiltApk> {
    // Prebuild writes it into build.gradle as versionName.
    const env = { ...process.env, LUSTRE_VERSION: version };
    say(`Building the Lustre ${version} APK`);

    await $`bunx expo prebuild --platform android --no-install`.cwd(APP_DIR).env(env);
    // Clinic phones are arm64. Add x86_64 for the emulator or Waydroid.
    const abis = process.env.LUSTRE_APK_ABIS ?? 'arm64-v8a';
    // A release build compiles every native module's Kotlin, and with
    // `kotlin.compiler.execution.strategy=in-process` that happens inside the
    // Gradle daemon: a 512 MiB metaspace runs out part-way and fails as a bare
    // InvocationTargetException. The flag outranks `~/.gradle/gradle.properties`.
    const task = DEV ? 'assembleDevRelease' : 'assembleRelease';
    await $`./gradlew ${task} -Dorg.gradle.jvmargs=${'-Xmx2048m -XX:MaxMetaspaceSize=1024m'}`
        .cwd(join(APP_DIR, 'android'))
        .env({
            ...env,
            ORG_GRADLE_PROJECT_reactNativeArchitectures: abis,
            // Sentry's Gradle hook uploads source maps on every release build and
            // fails the build without a GlitchTip token. Off unless asked for.
            SENTRY_DISABLE_AUTO_UPLOAD: process.env.SENTRY_DISABLE_AUTO_UPLOAD ?? 'true',
        });

    const outputs = JSON.parse(
        await readFile(join(APK_OUTPUTS, 'output-metadata.json'), 'utf8'),
    ) as ApkOutputMetadata;
    const element = outputs.elements?.[0];
    if (!element?.versionCode || !element.versionName || !element.outputFile) {
        fail('the build wrote no release APK metadata');
    }
    // A release built under the dev build type's id would install beside the
    // clinic's app rather than update it, and take no OTA update meant for it.
    if (outputs.applicationId !== APPLICATION_ID) {
        fail(`the build installs as ${outputs.applicationId}, not ${APPLICATION_ID}`);
    }
    if (element.versionName !== version) {
        fail(
            `the build is named ${element.versionName}, not ${version}. Delete packages/app/android and run again.`,
        );
    }
    const apk = join(APK_OUTPUTS, element.outputFile);
    await assertApkKey(apk);

    // The Settings banner offers only a strictly higher build, so a build that is
    // not higher than the one already staged would reach no phone.
    const staged = await stagedApk();
    if (staged?.versionCode && element.versionCode <= staged.versionCode) {
        fail(
            `build ${element.versionCode} is not higher than the staged build ${staged.versionCode}. Rebuild, or set ORG_GRADLE_PROJECT_LUSTRE_VERSION_CODE above it.`,
        );
    }

    return {
        bytes: new Uint8Array(await readFile(apk)),
        versionCode: element.versionCode,
        version: element.versionName,
        runtimeVersion: await resolvedRuntimeVersion(),
        abis,
    };
}

async function stageApk(built: BuiltApk, url: string): Promise<void> {
    const { bytes } = built;
    await atomicWrite(join(OUT_DIR, 'android/lustre.apk'), bytes);
    await atomicWrite(
        join(OUT_DIR, 'android/latest.json'),
        `${JSON.stringify(
            {
                versionCode: built.versionCode,
                version: built.version,
                runtimeVersion: built.runtimeVersion,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                // The server offers the APK only once a file of this size is beside it.
                size: bytes.length,
                updatesUrl: url,
                commit: await headCommit(),
                builtAt: new Date().toISOString(),
            },
            null,
            4,
        )}\n`,
    );
    say(`Staged Lustre ${built.version} (build ${built.versionCode}, ${built.abis}) in ${OUT_DIR}/android`);
}

function assertExpected(next: Version): void {
    const expected = process.env.LUSTRE_EXPECT_VERSION?.trim();
    if (expected && expected !== formatVersion(next)) {
        fail(`this release is ${formatVersion(next)}, not ${expected} as expected. Nothing was built.`);
    }
}

async function nextApk(major: boolean): Promise<Version> {
    const staged = await stagedApk();
    return nextApkVersion([...(await taggedVersions()), staged?.version], major);
}

/** The next update's number, and the runtime it is for: the staged APK's, or it fails. */
async function nextUpdate(minor: boolean): Promise<{ next: Version; runtimeVersion: string }> {
    // An update is numbered on the APK it is for, and that is the APK whose
    // runtime it has. With no such APK staged it would reach no phone.
    const runtimeVersion = await resolvedRuntimeVersion();
    const apk = await stagedApk();
    const apkVersion = apk?.version ? parseVersion(apk.version) : null;
    if (!apk || !apkVersion) fail('no numbered APK is staged. Ship one with `bun ship --apk` first.');
    if (apk.runtimeVersion !== runtimeVersion) {
        fail(
            `this code is runtime ${runtimeVersion}, but the staged APK (${apk.version}, build ${apk.versionCode}) is runtime ${apk.runtimeVersion}. No phone would take the update: something native changed, so ship an APK with \`bun ship --apk\`.`,
        );
    }
    const next = nextUpdateVersion(
        apkVersion,
        [...(await taggedVersions()), ...(await publishedUpdateVersions(runtimeVersion))],
        minor,
    );
    return { next, runtimeVersion };
}

async function releaseApk(major: boolean): Promise<void> {
    const url = updatesUrl();
    const dsn = await glitchtipDsn(url);
    await assertCleanTree();

    const next = await nextApk(major);
    assertExpected(next);
    const built = await buildApk(formatVersion(next));
    await stageApk(built, url);

    say(`Runtime version ${built.runtimeVersion}. Updates from ${url}`);
    say(
        dsn
            ? `Crash reports to ${dsn.slice(dsn.indexOf('@') + 1)}`
            : 'Crash reporting off (dev or demo build)',
    );
    await tagRelease(next, `Lustre ${built.version}, APK build ${built.versionCode}`);
}

async function publishUpdate(minor: boolean, screen: boolean, withApk: boolean): Promise<void> {
    const url = updatesUrl();
    // Not used here, but checked: the DSN is hashed into the runtime fingerprint, so
    // an update published without the one the APK was built with resolves a runtime
    // no phone is on.
    await glitchtipDsn(url);
    const keyPath = await gradleProperty('LUSTRE_UPDATES_PRIVATE_KEY');
    if (!keyPath) {
        fail(
            'LUSTRE_UPDATES_PRIVATE_KEY is not set in the environment or ~/.gradle/gradle.properties (infra/README.md, Release signing)',
        );
    }
    const privateKey = await readFile(keyPath, 'utf8').catch(() =>
        fail(`cannot read the update signing key at ${keyPath}`),
    );
    await assertCleanTree();

    const { next, runtimeVersion } = await nextUpdate(minor);
    assertExpected(next);
    const version = formatVersion(next);
    // What `Constants.expoConfig.version` reads on a phone running this update.
    const env = { ...process.env, LUSTRE_VERSION: version };
    say(`Publishing Lustre ${version}${screen ? ', behind the download screen' : ''}`);

    // Only with --with-apk: the APK a fresh install downloads, rebuilt with this
    // update's JavaScript in it. Without it a fresh install starts on the staged
    // APK's bundle and takes this update on first launch, which saves a Gradle
    // build and a 56 MB upload on every patch. Built first: a failed build stages
    // nothing. Phones already on this runtime are not offered it (`newerApk`), as
    // the update brings them the same.
    const built = withApk ? await buildApk(version) : null;
    if (built && built.runtimeVersion !== runtimeVersion) {
        fail(
            `the rebuilt APK is runtime ${built.runtimeVersion}, but this update is ${runtimeVersion}. Nothing was staged.`,
        );
    }

    const staging = await mkdtemp(join(tmpdir(), 'lustre-update-'));
    await $`bunx expo export --platform android --output-dir ${staging}`.cwd(APP_DIR).env(env);

    const exported = JSON.parse(await readFile(join(staging, 'metadata.json'), 'utf8')) as ExportMetadata;
    const android = exported.fileMetadata?.android;
    if (!android) fail('expo export wrote no Android bundle');
    // What the running app reads as `Constants.expoConfig` once it is on this update.
    const expoClient = JSON.parse(
        await $`bunx expo config --type public --json`.cwd(APP_DIR).env(env).quiet().text(),
    ) as Record<string, unknown>;

    const load = async (path: string, ext: string): Promise<ExportedFile> => ({
        path,
        ext,
        bytes: new Uint8Array(await readFile(join(staging, path))),
    });
    const bundle = await load(android.bundle, 'bundle');
    const assets = await Promise.all(android.assets.map((asset) => load(asset.path, asset.ext)));

    const id = randomUUID();
    const createdAt = new Date();
    const body = JSON.stringify(
        manifestFor({
            id,
            createdAt,
            runtimeVersion,
            version,
            screen,
            serverUrl: url,
            bundle,
            assets,
            expoClient,
        }),
    );

    const target = join(OUT_DIR, 'updates', runtimeVersion, id);
    for (const file of [bundle, ...assets]) {
        await mkdir(dirname(join(target, file.path)), { recursive: true });
        await copyFile(join(staging, file.path), join(target, file.path));
    }
    await writeFile(join(target, 'manifest.json'), body);
    await writeFile(join(target, 'signature'), `${signManifest(body, privateKey)}\n`);
    // Last, so the pointer never names an update whose files are still landing.
    await atomicWrite(
        join(OUT_DIR, 'updates', runtimeVersion, 'latest.json'),
        `${JSON.stringify({ id, createdAt: createdAt.toISOString() })}\n`,
    );
    await rm(staging, { recursive: true, force: true });

    say(`Staged Lustre ${version} (update ${id}) for runtime ${runtimeVersion} in ${target}`);
    if (built) await stageApk(built, url);
    await tagRelease(
        next,
        `Lustre ${version}, update ${id}${built ? `, APK build ${built.versionCode}` : ''}`,
    );
}

const [command, kind] = process.argv.slice(2);
const major = process.argv.includes('--major');
const minor = process.argv.includes('--minor');
const screen = process.argv.includes('--screen');
const withApk = process.argv.includes('--with-apk');
if (command === 'apk') await releaseApk(major);
else if (command === 'update') await publishUpdate(minor, screen, withApk);
else if (command === 'next' && kind === 'apk') say(formatVersion(await nextApk(major)));
else if (command === 'next' && kind === 'update') say(formatVersion((await nextUpdate(minor)).next));
else
    fail(
        'usage: bun packages/app/scripts/release.ts [next] apk [--major] | [next] update [--minor] [--screen] [--with-apk]',
    );
