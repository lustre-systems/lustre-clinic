import { createSign } from 'node:crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_SKEW_SECONDS = 60;

interface CommonDriveCredentials {
    folderId: string;
}

export interface OAuthDriveCredentials extends CommonDriveCredentials {
    kind: 'oauth';
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
}

export interface ServiceAccountDriveCredentials extends CommonDriveCredentials {
    kind?: 'service-account';
    clientEmail: string;
    privateKey: string;
    subject?: string;
    scope?: string;
}

export type DriveCredentials = OAuthDriveCredentials | ServiceAccountDriveCredentials;

export interface DriveOptions {
    credentials: DriveCredentials;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    now?: () => number;
}

export interface DriveFile {
    id: string;
    name: string;
}

export interface OAuthAuthorizationOptions {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    loginHint?: string;
}

export interface DriveSignInConfig {
    clientId: string;
    redirectUri: string;
    scope: string;
}

export interface OAuthCodeExchangeOptions {
    clientId: string;
    clientSecret?: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export const DRIVE_REAUTHORIZATION_CODE = 'backup.drive_reauthorization_required';

export class DriveReauthorizationRequiredError extends Error {
    constructor() {
        super(
            'Google Drive authorization expired or was revoked; run `bun drive:authorize` on the operator machine',
        );
        this.name = 'DriveReauthorizationRequiredError';
    }
}

export function isDriveReauthorizationRequired(error: unknown): error is DriveReauthorizationRequiredError {
    return error instanceof DriveReauthorizationRequiredError;
}

function base64Url(input: string | Uint8Array): string {
    return Buffer.from(input as never)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function isOAuth(credentials: DriveCredentials): credentials is OAuthDriveCredentials {
    return credentials.kind === 'oauth';
}

export function normalizePrivateKey(raw: string): string {
    const key = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
    if (!key.includes('BEGIN')) {
        throw new Error('BACKUP_DRIVE_PRIVATE_KEY does not look like a PEM private key');
    }
    return key.trim();
}

export function buildJwt(credentials: ServiceAccountDriveCredentials, nowMs: number): string {
    const issuedAt = Math.floor(nowMs / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: credentials.clientEmail,
        scope: credentials.scope ?? DRIVE_SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
        ...(credentials.subject ? { sub: credentials.subject } : {}),
    };

    const body = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256').update(body).sign(normalizePrivateKey(credentials.privateKey));
    return `${body}.${base64Url(signature)}`;
}

export function createOAuthAuthorizationUrl(options: OAuthAuthorizationOptions): string {
    const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state: options.state,
        code_challenge: options.codeChallenge,
        code_challenge_method: 'S256',
    });
    if (options.loginHint) params.set('login_hint', options.loginHint);
    return `${AUTH_URL}?${params}`;
}

export async function exchangeOAuthCode(options: OAuthCodeExchangeOptions): Promise<{
    accessToken: string;
    refreshToken: string;
}> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: options.clientId,
            ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
            code: options.code,
            code_verifier: options.codeVerifier,
            redirect_uri: options.redirectUri,
            grant_type: 'authorization_code',
        }).toString(),
        signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok)
        throw new Error(`drive authorization-code exchange failed: ${res.status} ${await safeText(res)}`);
    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !json.refresh_token) {
        throw new Error(
            'Google did not return both access and refresh tokens; revoke the old grant and try again',
        );
    }
    return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

export async function createDriveFolder(
    accessToken: string,
    name: string,
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
    const res = await fetchImpl(`${FILES_URL}?fields=id&supportsAllDrives=true`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`drive folder creation failed: ${res.status} ${await safeText(res)}`);
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error('drive folder creation response had no folder id');
    return json.id;
}

export interface DriveClient {
    upload(name: string, body: Uint8Array, mimeType?: string): Promise<string>;
    list(): Promise<DriveFile[]>;
    remove(fileId: string): Promise<void>;
}

export function createDriveClient(options: DriveOptions): DriveClient {
    const { credentials, fetchImpl = fetch, now = Date.now } = options;
    let cached: { token: string; expiresAtMs: number } | undefined;

    async function accessToken(): Promise<string> {
        if (cached && cached.expiresAtMs > now()) return cached.token;

        const body = isOAuth(credentials)
            ? new URLSearchParams({
                  client_id: credentials.clientId,
                  ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
                  refresh_token: credentials.refreshToken,
                  grant_type: 'refresh_token',
              })
            : new URLSearchParams({
                  grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                  assertion: buildJwt(credentials, now()),
              });

        const res = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
            const response = await safeText(res);
            if (isOAuth(credentials) && res.status === 400 && hasInvalidGrant(response)) {
                throw new DriveReauthorizationRequiredError();
            }
            throw new Error(`drive token request failed: ${res.status} ${response}`);
        }

        const json = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!json.access_token) throw new Error('drive token response had no access_token');
        cached = {
            token: json.access_token,
            expiresAtMs: now() + Math.max(0, (json.expires_in ?? 3600) - TOKEN_SKEW_SECONDS) * 1000,
        };
        return cached.token;
    }

    async function authed(url: string, init: RequestInit = {}): Promise<Response> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const token = await accessToken();
            const res = await fetchImpl(url, {
                ...init,
                headers: { ...init.headers, authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(10 * 60_000),
            });
            if (res.status !== 401) return res;
            cached = undefined;
        }
        if (isOAuth(credentials)) throw new DriveReauthorizationRequiredError();
        return new Response('unauthorized', { status: 401 });
    }

    return {
        async upload(name, body, mimeType = 'application/octet-stream'): Promise<string> {
            const metadata = { name, parents: [credentials.folderId] };
            const boundary = `lustre-${crypto.randomUUID()}`;
            const parts = Buffer.concat([
                Buffer.from(
                    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
                        `${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`,
                ),
                Buffer.from(body),
                Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);

            const res = await authed(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true`, {
                method: 'POST',
                headers: { 'content-type': `multipart/related; boundary=${boundary}` },
                body: parts,
            });
            if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${await safeText(res)}`);
            const json = (await res.json()) as { id?: string };
            if (!json.id) throw new Error('drive upload response had no file id');
            return json.id;
        },

        async list(): Promise<DriveFile[]> {
            const files: DriveFile[] = [];
            let pageToken: string | undefined;
            do {
                const params = new URLSearchParams({
                    q: `'${credentials.folderId}' in parents and trashed = false`,
                    fields: 'nextPageToken, files(id, name)',
                    pageSize: '1000',
                    supportsAllDrives: 'true',
                    includeItemsFromAllDrives: 'true',
                });
                if (pageToken) params.set('pageToken', pageToken);
                const res = await authed(`${FILES_URL}?${params}`);
                if (!res.ok) throw new Error(`drive list failed: ${res.status} ${await safeText(res)}`);
                const json = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
                files.push(...(json.files ?? []));
                pageToken = json.nextPageToken;
            } while (pageToken);
            return files;
        },

        async remove(fileId: string): Promise<void> {
            const res = await authed(`${FILES_URL}/${fileId}?supportsAllDrives=true`, { method: 'DELETE' });
            if (!res.ok && res.status !== 404) {
                throw new Error(`drive delete failed: ${res.status} ${await safeText(res)}`);
            }
        },
    };
}

function hasInvalidGrant(body: string): boolean {
    try {
        return (JSON.parse(body) as { error?: string }).error === 'invalid_grant';
    } catch {
        return /invalid_grant/i.test(body);
    }
}

async function safeText(res: Response): Promise<string> {
    try {
        return (await res.text()).slice(0, 300);
    } catch {
        return '';
    }
}
