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
    const redirectUri = `${Application.applicationId}:/oauth2redirect`;
    const request = new AuthSession.AuthRequest({
        clientId,
        redirectUri,
        scopes: [DRIVE_SCOPE],
        usePKCE: true,
        extraParams: { access_type: 'offline', prompt: 'consent', hl: getLocale() },
    });

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
