import { describe, expect, test } from 'bun:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { resolveDriveCredentials } from '../src/backup/destination.ts';
import {
    buildJwt,
    createDriveClient,
    createDriveFolder,
    createOAuthAuthorizationUrl,
    type DriveCredentials,
    DriveReauthorizationRequiredError,
    exchangeOAuthCode,
    isDriveReauthorizationRequired,
    normalizePrivateKey,
    type ServiceAccountDriveCredentials,
} from '../src/backup/drive.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const credentials: ServiceAccountDriveCredentials = {
    clientEmail: 'lustre-backup@example.iam.gserviceaccount.com',
    privateKey: PEM,
    folderId: 'folder-123',
};

const oauthCredentials: DriveCredentials = {
    kind: 'oauth',
    clientId: 'desktop-client.apps.googleusercontent.com',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    folderId: 'folder-123',
};

function decodeSegment(segment: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(segment, 'base64url').toString());
}

function stubFetch(handlers: Record<string, (req: { url: string; init?: RequestInit }) => Response>) {
    const calls: { url: string; init?: RequestInit }[] = [];

    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        const key = Object.keys(handlers).find((k) => url.includes(k));
        if (!key) throw new Error(`unexpected request to ${url}`);
        return handlers[key]?.({ url, init }) ?? new Response(null, { status: 500 });
    };

    return { impl, calls };
}

const tokenOk = () =>
    new Response(JSON.stringify({ access_token: 'token-abc', expires_in: 3600 }), {
        headers: { 'content-type': 'application/json' },
    });

describe('normalizePrivateKey', () => {
    test('turns escaped newlines back into a PEM', () => {
        const escaped = PEM.replace(/\n/g, '\\n');
        expect(normalizePrivateKey(escaped)).toBe(PEM.trim());
    });

    test('leaves a real PEM alone', () => {
        expect(normalizePrivateKey(PEM)).toBe(PEM.trim());
    });

    test('rejects something that is not a key', () => {
        expect(() => normalizePrivateKey('hunter2')).toThrow('PEM private key');
    });
});

describe('buildJwt', () => {
    const now = Date.parse('2026-08-03T09:00:00Z');

    test('signs a verifiable RS256 assertion', () => {
        const jwt = buildJwt(credentials, now);
        const [header, claims, signature] = jwt.split('.');

        expect(decodeSegment(header ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' });

        const verifier = createVerify('RSA-SHA256').update(`${header}.${claims}`);
        expect(verifier.verify(PUBLIC_PEM, Buffer.from(signature ?? '', 'base64url'))).toBe(true);
    });

    test('claims what Google expects of a service account', () => {
        const claims = decodeSegment(buildJwt(credentials, now).split('.')[1] ?? '');

        expect(claims.iss).toBe(credentials.clientEmail);
        expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
        expect(claims.scope).toBe('https://www.googleapis.com/auth/drive.file');
        expect(claims.iat).toBe(now / 1000);
        expect(claims.exp).toBe(now / 1000 + 3600);
        expect(claims.sub).toBeUndefined();
    });

    test('carries the subject when impersonating', () => {
        const claims = decodeSegment(
            buildJwt({ ...credentials, subject: 'doctor@clinic.example' }, now).split('.')[1] ?? '',
        );
        expect(claims.sub).toBe('doctor@clinic.example');
    });
});

describe('operator OAuth flow', () => {
    test('requests offline drive.file access with PKCE and state', () => {
        const url = new URL(
            createOAuthAuthorizationUrl({
                clientId: 'client-id',
                redirectUri: 'http://127.0.0.1:1234/oauth/callback',
                state: 'state-123',
                codeChallenge: 'challenge-123',
                loginHint: 'doctor@example.com',
            }),
        );

        expect(url.origin).toBe('https://accounts.google.com');
        expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
        expect(url.searchParams.get('state')).toBe('state-123');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('login_hint')).toBe('doctor@example.com');
    });

    test('exchanges the code and creates an app-owned folder', async () => {
        const { impl, calls } = stubFetch({
            'oauth2.googleapis.com/token': () =>
                new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1' })),
            'drive/v3/files': ({ init }) => {
                expect(init?.headers).toMatchObject({ authorization: 'Bearer access-1' });
                expect(JSON.parse(String(init?.body))).toEqual({
                    name: 'Lustre Clinic Backups',
                    mimeType: 'application/vnd.google-apps.folder',
                });
                return new Response(JSON.stringify({ id: 'folder-new' }));
            },
        });

        const tokens = await exchangeOAuthCode({
            clientId: 'client-id',
            clientSecret: 'client-secret',
            code: 'authorization-code',
            codeVerifier: 'verifier',
            redirectUri: 'http://127.0.0.1:1234/oauth/callback',
            fetchImpl: impl,
        });
        const folderId = await createDriveFolder(tokens.accessToken, 'Lustre Clinic Backups', impl);

        expect(tokens.refreshToken).toBe('refresh-1');
        expect(folderId).toBe('folder-new');
        const tokenBody = new URLSearchParams(String(calls[0]?.init?.body));
        expect(tokenBody.get('grant_type')).toBe('authorization_code');
        expect(tokenBody.get('code_verifier')).toBe('verifier');
    });
});

describe('operator OAuth flow, refused', () => {
    test('refuses a grant Google would not issue a refresh token for', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': () => new Response(JSON.stringify({ access_token: 'access-1' })),
        });

        await expect(
            exchangeOAuthCode({
                clientId: 'client-id',
                clientSecret: 'client-secret',
                code: 'authorization-code',
                codeVerifier: 'verifier',
                redirectUri: 'http://127.0.0.1:1234/oauth/callback',
                fetchImpl: impl,
            }),
        ).rejects.toThrow('revoke the old grant');
    });
});

describe('createDriveClient', () => {
    test('exchanges an OAuth refresh token without persisting the access token', async () => {
        const { impl, calls } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'drive/v3/files': () => new Response(JSON.stringify({ files: [] })),
        });

        const client = createDriveClient({ credentials: oauthCredentials, fetchImpl: impl });
        await client.list();
        await client.list();

        const tokenCalls = calls.filter((call) => call.url.includes('token'));
        expect(tokenCalls).toHaveLength(1);
        const body = new URLSearchParams(String(tokenCalls[0]?.init?.body));
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('refresh-token');
        expect(body.has('assertion')).toBe(false);
    });

    test('turns a revoked OAuth grant into an actionable reauthorization error', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': () =>
                new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
        });

        const error = await createDriveClient({ credentials: oauthCredentials, fetchImpl: impl })
            .list()
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(DriveReauthorizationRequiredError);
        expect(isDriveReauthorizationRequired(error)).toBe(true);
        expect((error as Error).message).toContain('drive:authorize');
    });

    test('asks for a new sign-in when a fresh token is still refused', async () => {
        let tokens = 0;
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': () => {
                tokens += 1;
                return new Response(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 3600 }));
            },
            'drive/v3/files': () => new Response('unauthorized', { status: 401 }),
        });

        const error = await createDriveClient({ credentials: oauthCredentials, fetchImpl: impl })
            .list()
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(DriveReauthorizationRequiredError);
        expect(tokens).toBe(2);
    });

    test('keeps a token refusal that is not a revoked grant generic', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': () =>
                new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 }),
        });

        const error = await createDriveClient({ credentials: oauthCredentials, fetchImpl: impl })
            .list()
            .catch((caught: unknown) => caught);

        expect(error).not.toBeInstanceOf(DriveReauthorizationRequiredError);
        expect((error as Error).message).toContain('drive token request failed: 400');
    });

    test('never puts the refresh token in an error a log or alert would carry', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': () =>
                new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
        });

        const error = await createDriveClient({
            credentials: { ...oauthCredentials, refreshToken: 'refresh-token-secret' },
            fetchImpl: impl,
        })
            .list()
            .catch((caught: unknown) => caught);

        expect((error as Error).message).not.toContain('refresh-token-secret');
    });

    test('exchanges the assertion for a token and uploads to the folder', async () => {
        let uploadBody: Buffer | undefined;

        const { impl, calls } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'upload/drive/v3/files': ({ init }) => {
                uploadBody = Buffer.from(init?.body as Uint8Array);
                return new Response(JSON.stringify({ id: 'file-1' }), {
                    headers: { 'content-type': 'application/json' },
                });
            },
        });

        const client = createDriveClient({ credentials, fetchImpl: impl });
        const id = await client.upload('lustre-2026-08-03T09-00-00Z.dump.enc', new Uint8Array([1, 2, 3]));

        expect(id).toBe('file-1');

        const upload = calls.find((c) => c.url.includes('upload'));
        expect(upload?.url).toContain('uploadType=multipart');
        expect(upload?.url).toContain('supportsAllDrives=true');
        const headers = (upload?.init?.headers ?? {}) as Record<string, string>;
        expect(headers.authorization).toBe('Bearer token-abc');

        const text = uploadBody?.toString('binary') ?? '';
        expect(text).toContain('"parents":["folder-123"]');
        expect(text).toContain('lustre-2026-08-03T09-00-00Z.dump.enc');
        expect(uploadBody?.includes(Buffer.from([1, 2, 3]))).toBe(true);
    });

    test('reuses the access token across calls', async () => {
        const { impl, calls } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'drive/v3/files': () =>
                new Response(JSON.stringify({ files: [] }), {
                    headers: { 'content-type': 'application/json' },
                }),
        });

        const client = createDriveClient({ credentials, fetchImpl: impl });
        await client.list();
        await client.list();

        expect(calls.filter((c) => c.url.includes('token')).length).toBe(1);
    });

    test('re-mints the token once it has expired', async () => {
        let clock = Date.parse('2026-08-03T09:00:00Z');

        const { impl, calls } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'drive/v3/files': () =>
                new Response(JSON.stringify({ files: [] }), {
                    headers: { 'content-type': 'application/json' },
                }),
        });

        const client = createDriveClient({ credentials, fetchImpl: impl, now: () => clock });
        await client.list();
        clock += 3600_000;
        await client.list();

        expect(calls.filter((c) => c.url.includes('token')).length).toBe(2);
    });

    test('follows pagination when listing', async () => {
        let page = 0;
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'drive/v3/files': () => {
                page += 1;
                return new Response(
                    JSON.stringify(
                        page === 1
                            ? { files: [{ id: 'a', name: 'one' }], nextPageToken: 'next' }
                            : { files: [{ id: 'b', name: 'two' }] },
                    ),
                    { headers: { 'content-type': 'application/json' } },
                );
            },
        });

        const files = await createDriveClient({ credentials, fetchImpl: impl }).list();
        expect(files.map((f) => f.id)).toEqual(['a', 'b']);
    });

    test('treats a missing file as already deleted', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'drive/v3/files': () => new Response('gone', { status: 404 }),
        });

        await expect(
            createDriveClient({ credentials, fetchImpl: impl }).remove('file-1'),
        ).resolves.toBeUndefined();
    });

    test('surfaces a refused token request', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': () => new Response('invalid_grant', { status: 400 }),
        });

        await expect(createDriveClient({ credentials, fetchImpl: impl }).list()).rejects.toThrow(
            'drive token request failed: 400',
        );
    });

    test('surfaces a refused upload', async () => {
        const { impl } = stubFetch({
            'oauth2.googleapis.com/token': tokenOk,
            'upload/drive/v3/files': () => new Response('storageQuotaExceeded', { status: 403 }),
        });

        await expect(
            createDriveClient({ credentials, fetchImpl: impl }).upload('x.dump.enc', new Uint8Array([1])),
        ).rejects.toThrow('storageQuotaExceeded');
    });
});

describe('resolveDriveCredentials', () => {
    const empty = {
        BACKUP_DRIVE_FOLDER_ID: undefined,
        BACKUP_DRIVE_OAUTH_CLIENT_ID: undefined,
        BACKUP_DRIVE_OAUTH_CLIENT_SECRET: undefined,
        BACKUP_DRIVE_REFRESH_TOKEN: undefined,
        BACKUP_DRIVE_CLIENT_EMAIL: undefined,
        BACKUP_DRIVE_PRIVATE_KEY: undefined,
        BACKUP_DRIVE_SUBJECT: undefined,
    };

    test('prefers a complete OAuth setup', () => {
        const resolved = resolveDriveCredentials({
            ...empty,
            BACKUP_DRIVE_FOLDER_ID: 'folder',
            BACKUP_DRIVE_OAUTH_CLIENT_ID: 'client',
            BACKUP_DRIVE_OAUTH_CLIENT_SECRET: 'secret',
            BACKUP_DRIVE_REFRESH_TOKEN: 'refresh',
            BACKUP_DRIVE_CLIENT_EMAIL: 'legacy@example.com',
            BACKUP_DRIVE_PRIVATE_KEY: PEM,
        });

        expect(resolved.credentials).toMatchObject({ kind: 'oauth', folderId: 'folder' });
        expect(resolved.missing).toEqual([]);
    });

    test('does not silently fall back when OAuth is only partly configured', () => {
        const resolved = resolveDriveCredentials({
            ...empty,
            BACKUP_DRIVE_FOLDER_ID: 'folder',
            BACKUP_DRIVE_OAUTH_CLIENT_ID: 'client',
            BACKUP_DRIVE_CLIENT_EMAIL: 'legacy@example.com',
            BACKUP_DRIVE_PRIVATE_KEY: PEM,
        });

        expect(resolved.credentials).toBeNull();
        expect(resolved.missing).toContain('BACKUP_DRIVE_REFRESH_TOKEN');
    });

    test('treats a blank or whitespace-only folder id as unset', () => {
        for (const folderId of ['', '   ']) {
            const resolved = resolveDriveCredentials({
                ...empty,
                BACKUP_DRIVE_FOLDER_ID: folderId,
                BACKUP_DRIVE_OAUTH_CLIENT_ID: 'client',
                BACKUP_DRIVE_OAUTH_CLIENT_SECRET: 'secret',
                BACKUP_DRIVE_REFRESH_TOKEN: 'refresh',
            });

            expect(resolved.credentials).toBeNull();
            expect(resolved.missing).toEqual(['BACKUP_DRIVE_FOLDER_ID']);
        }
    });

    test('trims values copied out of the authorize output', () => {
        const resolved = resolveDriveCredentials({
            ...empty,
            BACKUP_DRIVE_FOLDER_ID: ' folder ',
            BACKUP_DRIVE_OAUTH_CLIENT_ID: 'client ',
            BACKUP_DRIVE_OAUTH_CLIENT_SECRET: ' secret',
            BACKUP_DRIVE_REFRESH_TOKEN: 'refresh\n',
        });

        expect(resolved.credentials).toEqual({
            kind: 'oauth',
            clientId: 'client',
            clientSecret: 'secret',
            refreshToken: 'refresh',
            folderId: 'folder',
        });
    });

    test('keeps the service-account path for Workspace compatibility', () => {
        const resolved = resolveDriveCredentials({
            ...empty,
            BACKUP_DRIVE_FOLDER_ID: 'shared-folder',
            BACKUP_DRIVE_CLIENT_EMAIL: 'legacy@example.com',
            BACKUP_DRIVE_PRIVATE_KEY: PEM,
        });

        expect(resolved.credentials).toMatchObject({ kind: 'service-account', folderId: 'shared-folder' });
    });
});
