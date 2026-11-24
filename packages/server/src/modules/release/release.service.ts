import { join, resolve } from 'node:path';
import { UPDATES_ASSETS_PATH } from '@lustre/shared';
import type { BunFile } from 'bun';
import { z } from 'zod';
import { config } from '../../config.ts';

const APK_FILE = 'lustre.apk';

const apkMetadata = z.object({
    versionCode: z.number().int().positive(),
    version: z.string().min(1),
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

        const signature = (await signatureFile.text()).trim();
        if (!signature) return null;

        const prefix = `${UPDATES_ASSETS_PATH}/${runtimeVersion}/${id}/`;
        if (!(await allFilesPresent(updateDir, prefix, await manifest.json().catch(() => null)))) return null;

        return { id, manifest: await manifest.text(), signature };
    },

    async updateAsset(segments: string[]): Promise<BunFile | null> {
        if (segments.length < 3 || !segments.every(isSafeSegment)) return null;
        return existing(join(releasesDir(), 'updates', ...segments));
    },
};
