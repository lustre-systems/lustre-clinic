import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as AuthSession from 'expo-auth-session';
import { useTRPC } from '../../../api';
import { getLocale } from '../../../i18n/runtime';
import { withUpdatesHeld } from '../../../shell/updateGate';

const DISCOVERY: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

type DriveSignInResult =
    | { kind: 'linked'; account: string | null }
    | { kind: 'cancelled' }
    | { kind: 'failed'; code: string };

export function useDriveSignIn() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const link = useMutation(trpc.backup.linkDrive.mutationOptions());

    async function signIn(): Promise<DriveSignInResult> {
        let config: { clientId: string; redirectUri: string; scope: string };
        try {
            config = await queryClient.fetchQuery(trpc.backup.signInConfig.queryOptions());
        } catch (error) {
            return { kind: 'failed', code: codeOf(error) };
        }

        const request = new AuthSession.AuthRequest({
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            scopes: [config.scope],
            usePKCE: true,
            extraParams: { access_type: 'offline', prompt: 'consent', hl: getLocale() },
        });

        return withUpdatesHeld(async () => {
            const result = await request.promptAsync(DISCOVERY);
            if (result.type !== 'success') return { kind: 'cancelled' };
            if (!request.codeVerifier) return { kind: 'failed', code: 'INTERNAL' };

            try {
                const linked = await link.mutateAsync({
                    code: result.params.code ?? '',
                    codeVerifier: request.codeVerifier,
                });
                await queryClient.invalidateQueries({ queryKey: trpc.backup.status.queryKey() });
                return { kind: 'linked', account: linked.account };
            } catch (error) {
                return { kind: 'failed', code: codeOf(error) };
            }
        });
    }

    return { signIn, linking: link.isPending };
}

function codeOf(error: unknown): string {
    const shape = error as { data?: { appCode?: string } } | null;
    return shape?.data?.appCode ?? 'INTERNAL';
}
