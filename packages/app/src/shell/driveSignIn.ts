/**
 * Linking this phone's own Drive for local mode's backups. Unlike the clinic
 * server's sign-in (`screens/settings/data/driveSignIn`), the phone finishes the
 * exchange itself: there is no server to hold the token.
 */
import * as Application from 'expo-application';
import * as AuthSession from 'expo-auth-session';
import { DRIVE_SCOPE, driveClientId, linkDrive } from '../api';
import { getLocale } from '../i18n/runtime';
import { registerDriveBackupTask } from './driveBackupTask';
import { withUpdatesHeld } from './updateGate';

const DISCOVERY: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export async function signInToDrive(): Promise<'linked' | 'cancelled' | 'failed'> {
    const clientId = driveClientId();
    if (!clientId) return 'failed';
    // Google requires the scheme to be the package name, which a dev build's differs in.
    const redirectUri = `${Application.applicationId}:/oauth2redirect`;
    const request = new AuthSession.AuthRequest({
        clientId,
        redirectUri,
        scopes: [DRIVE_SCOPE],
        usePKCE: true,
        extraParams: { access_type: 'offline', prompt: 'consent', hl: getLocale() },
    });

    // Google's screens leave the app; coming back must not restart it into an update mid-link.
    return withUpdatesHeld(async () => {
        const result = await request.promptAsync(DISCOVERY);
        if (result.type !== 'success') return 'cancelled';
        if (!request.codeVerifier || !result.params.code) return 'failed';
        try {
            const tokens = await AuthSession.exchangeCodeAsync(
                {
                    clientId,
                    redirectUri,
                    code: result.params.code,
                    extraParams: { code_verifier: request.codeVerifier },
                },
                DISCOVERY,
            );
            if (!tokens.refreshToken) return 'failed';
            await linkDrive(tokens.refreshToken, tokens.accessToken);
            await registerDriveBackupTask();
            return 'linked';
        } catch {
            return 'failed';
        }
    });
}
