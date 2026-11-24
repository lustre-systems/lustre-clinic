import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
// biome-ignore lint/style/noRestrictedImports: follows the native updater, and AppState for the return to the app
import { useEffect, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { ProgressBar } from '../components/ui';
import { useT } from '../i18n';
import { color, radius, space, Text } from '../theme';
import {
    CHECK_EVERY_MS,
    isMinorUpdate,
    manifestVersion,
    manifestWantsScreen,
    reloadOnReturn,
    updatesHeld,
} from './updateGate';

export function UpdateScreen() {
    const t = useT();
    const {
        availableUpdate,
        downloadedUpdate,
        isDownloading,
        isUpdatePending,
        downloadProgress,
        downloadError,
    } = Updates.useUpdates();

    useQuietUpdates(isUpdatePending);

    const manifest = (downloadedUpdate ?? availableUpdate)?.manifest;
    const incoming = manifestVersion(manifest);
    const screen = isMinorUpdate(Constants.expoConfig?.version, incoming) || manifestWantsScreen(manifest);
    const restarting = screen && isUpdatePending;

    useEffect(() => {
        if (restarting) void Updates.reloadAsync().catch(() => undefined);
    }, [restarting]);

    if (!screen || downloadError || !(isDownloading || isUpdatePending)) return null;

    return (
        <View style={styles.root} testID="update-screen">
            <View style={styles.card}>
                <Text variant="title3">{t('Updating the app')}</Text>
                <Text variant="subhead" tone="muted" style={styles.body}>
                    {t(
                        restarting
                            ? 'Version {version} is ready. Restarting…'
                            : 'Downloading version {version}. The app restarts by itself when it is done.',
                        { version: incoming ?? '' },
                    )}
                </Text>
                <View style={styles.bar}>
                    <ProgressBar value={restarting ? 1 : (downloadProgress ?? 0)} />
                </View>
            </View>
        </View>
    );
}

let drawnBefore = false;
let checking = false;
let returnedAt: number | null = null;

function fetchQuietly() {
    if (checking) return;
    checking = true;
    void Updates.checkForUpdateAsync()
        .then((check) => (check.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        .catch(() => undefined)
        .finally(() => {
            checking = false;
        });
}

function reloadIfDue(updatePending: boolean) {
    const since = returnedAt === null ? null : Date.now() - returnedAt;
    if (reloadOnReturn(updatePending, since, updatesHeld()))
        void Updates.reloadAsync().catch(() => undefined);
}

function onReturn(updatePending: boolean) {
    returnedAt = Date.now();
    if (updatePending) reloadIfDue(updatePending);
    else fetchQuietly();
}

function useQuietUpdates(updatePending: boolean) {
    const pending = useRef(updatePending);
    pending.current = updatePending;

    useEffect(() => {
        if (!Updates.isEnabled) return;
        if (drawnBefore) onReturn(pending.current);
        else returnedAt = Date.now();
        drawnBefore = true;

        let away = false;
        const timer = setInterval(fetchQuietly, CHECK_EVERY_MS);
        const subscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active') {
                away = true;
            } else if (away) {
                away = false;
                onReturn(pending.current);
            }
        });
        return () => {
            clearInterval(timer);
            subscription.remove();
        };
    }, []);

    useEffect(() => {
        if (Updates.isEnabled) reloadIfDue(updatePending);
    }, [updatePending]);
}

const styles = StyleSheet.create({
    root: {
        ...StyleSheet.absoluteFill,
        backgroundColor: color.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[5],
    },
    card: {
        alignSelf: 'stretch',
        alignItems: 'center',
        gap: space[2],
        paddingVertical: space[8],
        paddingHorizontal: space[5],
        borderRadius: radius.xl2,
        backgroundColor: color.surface,
    },
    body: { textAlign: 'center' },
    bar: { alignSelf: 'stretch', marginTop: space[4] },
});
