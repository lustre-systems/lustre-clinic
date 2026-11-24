import { UPDATES_ASSETS_PATH } from '@lustre/shared';
import { config } from '../../config.ts';
import { releaseService } from './release.service.ts';

const PROTOCOL_HEADERS = {
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
};

export async function serveApk(): Promise<Response> {
    const apk = await releaseService.apk();
    if (!apk) return new Response('No release APK has been published', { status: 404 });

    const name = `lustre-${apk.metadata.version}-${apk.metadata.versionCode}.apk`.replace(/[^\w.-]/g, '');
    return new Response(apk.file, {
        headers: {
            'content-type': 'application/vnd.android.package-archive',
            'content-disposition': `attachment; filename="${name}"`,
            'cache-control': 'no-cache',
        },
    });
}

export async function serveUpdateManifest(req: Request): Promise<Response> {
    const runtimeVersion = req.headers.get('expo-runtime-version');
    if (
        req.headers.get('expo-protocol-version') !== '1' ||
        req.headers.get('expo-platform') !== 'android' ||
        !runtimeVersion
    ) {
        return new Response('Expected an expo-updates protocol 1 request from Android', { status: 400 });
    }

    if (req.headers.get('expo-channel-name') !== config.UPDATES_CHANNEL) return noUpdate();

    const update = await releaseService.latestUpdate(runtimeVersion);
    if (!update || update.id === req.headers.get('expo-current-update-id')) return noUpdate();

    const headers: Record<string, string> = {
        ...PROTOCOL_HEADERS,
        'content-type': 'application/json; charset=utf-8',
    };
    if (update.signature) headers['expo-signature'] = update.signature;
    return new Response(update.manifest, { headers });
}

function noUpdate(): Response {
    return new Response(null, { status: 204, headers: PROTOCOL_HEADERS });
}

export async function serveUpdateAsset(pathname: string): Promise<Response> {
    const segments = pathname.slice(UPDATES_ASSETS_PATH.length + 1).split('/');
    const file = await releaseService.updateAsset(segments);
    if (!file) return new Response('Not found', { status: 404 });

    return new Response(file, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
}
