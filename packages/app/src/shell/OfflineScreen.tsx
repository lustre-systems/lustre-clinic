import type { CopyVars } from '@lustre/shared';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { allowsLan, BUILD_VARIANT, useConnection } from '../api';
import { GLYPH } from '../components/domain';
import { Button } from '../components/ui';
import { useT } from '../i18n';
import { SavedScheduleList, useSavedSchedule } from '../screens/day';
import { color, space, Text } from '../theme';
import { DeadEnd } from './DeadEnd';
import { requestReconfigure } from './serverStore';

export function OfflineScreen() {
    const t = useT();
    const { retry, lastOnlineAt } = useConnection();
    const [retrying, setRetrying] = useState(false);
    const saved = useSavedSchedule();

    async function tryAgain() {
        setRetrying(true);
        try {
            await retry();
        } finally {
            setRetrying(false);
        }
    }

    return (
        <DeadEnd
            glyph={<GLYPH.offline size={22} color={color.ink2} strokeWidth={2} />}
            title={t('No connection to the clinic')}
            body={t(
                allowsLan(BUILD_VARIANT)
                    ? 'The app cannot reach the clinic computer. Check that you are on the clinic wifi or Tailscale, then try again.'
                    : 'The app cannot reach the clinic computer. Check that you are signed in to Tailscale, then try again.',
            )}
            after={saved ? <SavedScheduleList schedule={saved} /> : null}
        >
            <Button
                label="Try again"
                onPress={tryAgain}
                loading={retrying}
                variant="primary"
                size="lg"
                block
                style={styles.action}
            />

            <Text variant="caption" tone="muted">
                {lastOnlineAt
                    ? t('Last connected {when}', { when: formatLastOnline(lastOnlineAt, t) })
                    : t('Never connected')}
            </Text>

            <Button
                label="Change server address"
                onPress={requestReconfigure}
                variant="text"
                size="md"
                style={styles.reconfigure}
            />
        </DeadEnd>
    );
}

function formatLastOnline(at: number, t: (copy: string, vars?: CopyVars) => string): string {
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) return t('just now');
    if (minutes < 60) return t('{minutes} min ago', { minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? t('1 hour ago') : t('{hours} hours ago', { hours });
    const days = Math.floor(hours / 24);
    return days === 1 ? t('yesterday') : t('{days} days ago', { days });
}

const styles = StyleSheet.create({
    action: { marginTop: space[4], marginBottom: space[2] },
    reconfigure: { marginTop: space[2], alignSelf: 'center' },
});
