import { grantCredential, trpcClient } from '../api';
import { ConfirmSheet, usePendingAction } from '../components/ui';
import { useT } from '../i18n';
import { errorText, GRANT_REFUSED, ROLE_NAME } from '../screens/settings';
import { clearPendingJoin, usePendingJoin } from './joinLink';

export function JoinSheet({ onDone }: { onDone: (message: string) => void }) {
    const t = useT();
    const join = usePendingJoin();

    const redeem = usePendingAction(async (code: string) => {
        try {
            const granted = await trpcClient.device.redeem.mutate({ code });
            grantCredential(granted);
            onDone(t('This phone is now {role}', { role: t(ROLE_NAME[granted.role]) }));
        } catch (error) {
            onDone(errorText(error, GRANT_REFUSED));
        } finally {
            clearPendingJoin();
        }
    });

    return (
        <ConfirmSheet
            visible={join !== null}
            title="Use this role code?"
            body="Lustre was opened with a role code. Using it gives this phone the role it was made for."
            confirmLabel="Use code"
            loading={redeem.pending}
            onConfirm={() => join && redeem.run(join.code)}
            onCancel={clearPendingJoin}
            testID="join-sheet"
        />
    );
}
