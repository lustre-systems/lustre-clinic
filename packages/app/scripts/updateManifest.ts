import { createHash, createSign } from 'node:crypto';
import { UPDATES_ASSETS_PATH } from '@lustre/shared';

export interface ExportedFile {
    path: string;
    ext: string;
    bytes: Uint8Array;
}

export interface ManifestInput {
    id: string;
    createdAt: Date;
    runtimeVersion: string;
    version: string;
    screen?: boolean;
    serverUrl: string;
    bundle: ExportedFile;
    assets: ExportedFile[];
    expoClient: Record<string, unknown>;
}

interface ManifestAsset {
    hash: string;
    key: string;
    contentType: string;
    fileExtension: string;
    url: string;
}

const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    otf: 'font/otf',
    json: 'application/json',
};

export function base64UrlSha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('base64url');
}

export function manifestFor(input: ManifestInput) {
    const base = input.serverUrl.replace(/\/+$/, '');
    const describe = (file: ExportedFile, contentType: string, fileExtension: string): ManifestAsset => ({
        hash: base64UrlSha256(file.bytes),
        key: createHash('md5').update(file.bytes).digest('hex'),
        contentType,
        fileExtension,
        url: `${base}${UPDATES_ASSETS_PATH}/${input.runtimeVersion}/${input.id}/${file.path}`,
    });

    return {
        id: input.id,
        createdAt: input.createdAt.toISOString(),
        runtimeVersion: input.runtimeVersion,
        launchAsset: describe(input.bundle, 'application/javascript', '.bundle'),
        assets: input.assets.map((asset) =>
            describe(asset, CONTENT_TYPES[asset.ext] ?? 'application/octet-stream', `.${asset.ext}`),
        ),
        metadata: input.screen ? { version: input.version, screen: 'true' } : { version: input.version },
        extra: { expoClient: input.expoClient },
    };
}

export function signManifest(body: string, privateKeyPem: string): string {
    const signature = createSign('RSA-SHA256').update(body, 'utf8').sign(privateKeyPem, 'base64');
    return `sig="${signature}", keyid="main"`;
}
