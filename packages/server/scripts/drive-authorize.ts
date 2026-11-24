import { createHash, randomBytes } from 'node:crypto';
import { createDriveFolder, createOAuthAuthorizationUrl, exchangeOAuthCode } from '../src/backup/drive.ts';

const clientId = Bun.env.BACKUP_DRIVE_OAUTH_CLIENT_ID;
const clientSecret = Bun.env.BACKUP_DRIVE_OAUTH_CLIENT_SECRET;
const loginHint = Bun.env.BACKUP_DRIVE_LOGIN_HINT;
const folderName = Bun.env.BACKUP_DRIVE_FOLDER_NAME?.trim() || 'Lustre Clinic Backups';
const existingFolderId = Bun.env.BACKUP_DRIVE_FOLDER_ID?.trim() || undefined;

if (!clientId || !clientSecret) {
    throw new Error(
        'set BACKUP_DRIVE_OAUTH_CLIENT_ID and BACKUP_DRIVE_OAUTH_CLIENT_SECRET from a Desktop OAuth client',
    );
}

const state = randomBytes(32).toString('base64url');
const codeVerifier = randomBytes(64).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
let redirectUri = '';

const callback = Promise.withResolvers<string>();
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== '/oauth/callback') return new Response('Not found', { status: 404 });
        if (url.searchParams.get('state') !== state) {
            callback.reject(new Error('OAuth callback state did not match; start the flow again'));
            return new Response('Authorization rejected: invalid state.', { status: 400 });
        }
        const oauthError = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        if (oauthError || !code) {
            callback.reject(new Error(`Google authorization failed: ${oauthError ?? 'no code returned'}`));
            return new Response('Authorization was not completed. You may close this tab.', { status: 400 });
        }
        callback.resolve(code);
        return new Response('Lustre Drive authorization complete. You may close this tab.');
    },
});

redirectUri = `http://127.0.0.1:${server.port}/oauth/callback`;
const authorizationUrl = createOAuthAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    loginHint,
});

console.log("Open this URL in a browser and sign in with the doctor's Google account:\n");
console.log(authorizationUrl);
console.log('\nWaiting up to five minutes for Google to return to this machine...');

const timeout = setTimeout(
    () => callback.reject(new Error('timed out waiting for Google authorization')),
    300_000,
);

try {
    const code = await callback.promise;
    const tokens = await exchangeOAuthCode({
        clientId,
        clientSecret,
        code,
        codeVerifier,
        redirectUri,
    });
    const folderId = existingFolderId ?? (await createDriveFolder(tokens.accessToken, folderName));

    console.log("\nAdd these values to the clinic server's private environment file (mode 0600):\n");
    console.log(`BACKUP_DRIVE_FOLDER_ID=${folderId}`);
    console.log(`BACKUP_DRIVE_OAUTH_CLIENT_ID=${clientId}`);
    console.log(`BACKUP_DRIVE_OAUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`BACKUP_DRIVE_REFRESH_TOKEN=${tokens.refreshToken}`);
    console.log(
        '\nThe access token was used once and was not stored. Clear this terminal after copying the values.',
    );
} finally {
    clearTimeout(timeout);
    server.stop(true);
}
