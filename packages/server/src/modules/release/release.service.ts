/**
 * SPEC §15. What the operator's release script (`packages/app/scripts/release.ts`)
 * stages in `RELEASES_DIR`, and `scripts/pushReleases.ts` copies to the clinic:
 *
 *   android/latest.json                 { versionCode, version, size, … }
 *   android/lustre.apk
 *   updates/<runtime>/latest.json       { id } — the update that runtime gets
 *   updates/<runtime>/<id>/manifest.json, signature, and the exported files
 *
 * The manifest is signed on the operator's machine when it is published, so the
 * private key never reaches this server, and it is served byte for byte because
 * the signature covers those bytes.
 *
 * The copy renames each file into place with the pointers last, but it lands
 * file by file and can be interrupted, and a releases directory may have come
 * by other means. So nothing is offered until everything it needs is here: an
 * APK whose size matches its metadata, and an update whose signature and every
 * file its manifest names are present. Offered early, a phone would download
 * the previous APK under the new build number, or fail an update's download on
 * every launch.
 *
 * The APK and the latest update need not be the same release: an OTA update
 * leaves the staged APK as it was, and a fresh install takes the update on its
 * first launch. Each is read on its own.
 *
 * Nothing here throws. No releases at all is where every fresh install starts,
 * and a phone reads "nothing newer" and "no answer" the same way.
 */
import { join, resolve } from 'node:path';
import { UPDATES_ASSETS_PATH } from '@lustre/shared';
import type { BunFile } from 'bun';
import { z } from 'zod';
import { config } from '../../config.ts';

const APK_FILE = 'lustre.apk';

const apkMetadata = z.object({
    versionCode: z.number().int().positive(),
    version: z.string().min(1),
    // What the APK's native code is. An APK on a runtime a phone already runs
    // brings it nothing an OTA update has not, so the phone is not offered it.
    runtimeVersion: z.string().min(1).optional(),
    size: z.number().int().positive().optional(),
});

const updatePointer = z.object({ id: z.uuid() });

const manifestFiles = z.object({
    launchAsset: z.object({ url: z.string() }),
    assets: z.array(z.object({ url: z.string() })),
});

type LatestApk = { versionCode: number; version: string; runtimeVersion: string | null };

interface PublishedUpdate {
    id: string;
    manifest: string;
    signature: string;
}

// Runtime versions are fingerprint hashes, ids are UUIDs and asset paths are
// what `expo export` writes, so a segment outside this pattern is refused before
// it reaches the filesystem. `.` and `..` fit the pattern and are refused by name.
function isSafeSegment(segment: string): boolean {
    return /^[A-Za-z0-9._-]+$/.test(segment) && segment !== '.' && segment !== '..';
}

function releasesDir(): string {
    return resolve(config.RELEASES_DIR);
}

async function existing(path: string): Promise<BunFile | null> {
    const file = Bun.file(path);
    return (await file.exists()) ? file : null;
}

async function readJson(path: string): Promise<unknown> {
    const file = await existing(path);
    return file ? file.json().catch(() => null) : null;
}

/** Whether every file the manifest points at is in `updateDir`, under the URL prefix it was published with. */
async function allFilesPresent(updateDir: string, prefix: string, manifest: unknown): Promise<boolean> {
    const parsed = manifestFiles.safeParse(manifest);
    if (!parsed.success) return false;

    const paths: string[] = [];
    for (const { url } of [parsed.data.launchAsset, ...parsed.data.assets]) {
        const at = url.indexOf(prefix);
        if (at === -1) return false;
        const path = url.slice(at + prefix.length);
        if (!path.split('/').every(isSafeSegment)) return false;
        paths.push(path);
    }

    const found = await Promise.all(paths.map((path) => Bun.file(join(updateDir, path)).exists()));
    return found.every(Boolean);
}

export const releaseService = {
    async latestApk(): Promise<LatestApk | null> {
        const android = join(releasesDir(), 'android');
        const metadata = apkMetadata.safeParse(await readJson(join(android, 'latest.json')));
        if (!metadata.success) return null;

        const apk = await existing(join(android, APK_FILE));
        if (!apk || (metadata.data.size !== undefined && apk.size !== metadata.data.size)) return null;
        return {
            versionCode: metadata.data.versionCode,
            version: metadata.data.version,
            runtimeVersion: metadata.data.runtimeVersion ?? null,
        };
    },

    async apk(): Promise<{ file: BunFile; metadata: LatestApk } | null> {
        const metadata = await releaseService.latestApk();
        const file = await existing(join(releasesDir(), 'android', APK_FILE));
        return metadata && file ? { file, metadata } : null;
    },

    async latestUpdate(runtimeVersion: string): Promise<PublishedUpdate | null> {
        if (!isSafeSegment(runtimeVersion)) return null;
        const runtimeDir = join(releasesDir(), 'updates', runtimeVersion);
        const pointer = updatePointer.safeParse(await readJson(join(runtimeDir, 'latest.json')));
        if (!pointer.success) return null;

        const { id } = pointer.data;
        const updateDir = join(runtimeDir, id);
        const [manifest, signatureFile] = await Promise.all([
            existing(join(updateDir, 'manifest.json')),
            existing(join(updateDir, 'signature')),
        ]);
        if (!manifest || !signatureFile) return null;

        // Release builds refuse a manifest without a valid signature, so an
        // unsigned one is no update rather than a failed download every launch.
        const signature = (await signatureFile.text()).trim();
        if (!signature) return null;

        const prefix = `${UPDATES_ASSETS_PATH}/${runtimeVersion}/${id}/`;
        if (!(await allFilesPresent(updateDir, prefix, await manifest.json().catch(() => null)))) return null;

        return { id, manifest: await manifest.text(), signature };
    },

    /** `segments` is `<runtime>/<id>/<path inside the export>`. */
    async updateAsset(segments: string[]): Promise<BunFile | null> {
        if (segments.length < 3 || !segments.every(isSafeSegment)) return null;
        return existing(join(releasesDir(), 'updates', ...segments));
    },
};
