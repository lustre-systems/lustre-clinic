import { Linking } from 'react-native';
import { useDemoMode } from '../api';
import { Banner, Button } from '../components/ui';
import { useT } from '../i18n';
import { useNotificationsAllowed } from '../notifications';
import { notificationsBannerSnooze, useSnooze } from './bannerSnoozeStore';
import { SnoozeActions } from './SnoozeActions';

export function NotificationsBanner() {
    const t = useT();
    const allowed = useNotificationsAllowed();
    const { enabled: demo } = useDemoMode();
    const snooze = useSnooze(notificationsBannerSnooze);

    if (demo || allowed !== 'blocked' || !snooze.hydrated || snooze.snoozed) return null;

    return (
        <Banner
            tone="warning"
            message={t('Notifications are off for this app')}
            action={
                <SnoozeActions store={notificationsBannerSnooze} testID="home-notifications-dismiss">
                    <Button
                        label="Open settings"
                        variant="text"
                        size="md"
                        onPress={() => void Linking.openSettings().catch(() => undefined)}
                        testID="home-notifications-settings"
                    />
                </SnoozeActions>
            }
        />
    );
}
