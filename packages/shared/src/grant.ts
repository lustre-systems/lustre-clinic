import qrcode from 'qrcode-generator';

export const GRANT_PREFIX = 'lustre-grant:v1:';

export const GRANT_TTL_MINUTES = 30;

export const MAX_DEVICE_LABEL = 60;

export const DEVICE_TOKEN_HEADER = 'authorization';

export function grantPayload(code: string): string {
    return `${GRANT_PREFIX}${code}`;
}

export const JOIN_PATH = '/join';

export const JOIN_APP_PATH = 'join';

export function joinUrl(server: string, code: string): string {
    return `${server.replace(/\/+$/, '')}${JOIN_PATH}#${code}`;
}

const CODE = /^[A-Za-z0-9_-]{16,128}$/;

export function grantCodeOf(scanned: string): string | null {
    const text = scanned.trim();
    const code = text.startsWith(GRANT_PREFIX)
        ? text.slice(GRANT_PREFIX.length)
        : (JOIN_PAGE.exec(text)?.[1] ?? appJoinParams(text)?.get('code') ?? null);
    return code && CODE.test(code) ? code : null;
}

const JOIN_PAGE = new RegExp(`^https?://[^/?#]+${JOIN_PATH}/?#([^#?&]+)$`);
const APP_JOIN = new RegExp(`^[a-z][a-z0-9.+-]*://${JOIN_APP_PATH}/?\\?(.*)$`, 'i');

function appJoinParams(link: string): Map<string, string> | null {
    const query = APP_JOIN.exec(link)?.[1];
    if (query === undefined) return null;
    const params = new Map<string, string>();
    for (const pair of query.split('&')) {
        const [key, value = ''] = pair.split('=');
        if (!key) continue;
        try {
            params.set(decodeURIComponent(key), decodeURIComponent(value));
        } catch {
            return null;
        }
    }
    return params;
}

export function joinLinkOf(link: string): { code: string; server: string | null } | null {
    const params = appJoinParams(link.trim());
    const code = params?.get('code');
    if (!params || !code || !CODE.test(code)) return null;
    const server = params.get('server') ?? null;
    return { code, server: server && /^https?:\/\/[^\s]+$/.test(server) ? server : null };
}

export function qrModules(text: string): boolean[][] {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    return Array.from({ length: count }, (_, row) =>
        Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
    );
}
