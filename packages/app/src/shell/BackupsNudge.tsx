import { useQuery } from '@tanstack/react-query';
import { driveClientId, useTRPC } from '../api';
import { Banner, Button } from '../components/ui';
import { useT } from '../i18n';
import { type LocalBackupWarning, localBackupWarning } from '../screens/settings/data/backups';
import { backupsBannerSnooze, useSnooze } from './bannerSnoozeStore';
import { SnoozeActions } from './SnoozeActions';

const MESSAGE: Record<LocalBackupWarning, string> = {
    off: 'Backups are off. If this phone is lost, the clinic is lost with it.',
    signedOut: 'Backups stopped. Google Drive needs a new sign-in.',
    behind: 'Backups are behind. The newest records are only on this phone.',
};

/**
 * The strip that says a clinic kept on one phone has no working backup. Over the
 * day it can be put away for a while (`bannerSnoozeStore`), as it names something
 * still wrong; on the settings index, where it is fixed, it stays.
 */
export function BackupsNudge({ onOpen, snoozable = false }: { onOpen: () => void; snoozable?: boolean }) {
    const t = useT();
    const trpc = useTRPC();
    const status = useQuery(trpc.backup.status.queryOptions());
    const snooze = useSnooze(backupsBannerSnooze);

    const warning = status.data ? localBackupWarning(status.data) : null;
    if (!driveClientId() || !warning) return null;
    if (snoozable && (!snooze.hydrated || snooze.snoozed)) return null;

    const open = (
        <Button
            label={warning === 'off' ? 'Turn on' : 'Open'}
            variant="text"
            size="md"
            onPress={onOpen}
            testID="backups-nudge-open"
        />
    );
    return (
        <Banner
            tone="warning"
            message={t(MESSAGE[warning])}
            action={
                snoozable ? (
                    <SnoozeActions store={backupsBannerSnooze} testID="backups-nudge-dismiss">
                        {open}
                    </SnoozeActions>
                ) : (
                    open
                )
            }
        />
    );
}
