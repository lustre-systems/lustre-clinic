import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { StatusBar } from 'expo-status-bar';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider, clinicGeneration, subscribeToDataReset } from './src/api';
import { ErrorBoundary } from './src/components/ui';
import { LocaleProvider, useT } from './src/i18n';
import { renderErrorReporter } from './src/reporting';
import {
    AppShell,
    DevBanner,
    SetupScreen,
    UpdateScreen,
    useJoinLinks,
    usePendingJoin,
    useServerSetup,
} from './src/shell';
import { color, useAppFonts } from './src/theme';

// The entry point mounts the shell (F3): the bottom tab bar and four clusters,
// each with its own internal navigation. The component gallery lives at
// `src/screens/dev/GalleryScreen` — mount it in place of `<AppShell />` when
// poking at a primitive on a device. `ApiProvider` wraps the whole shell
// because the query cache and connection state outlive any one tab.
//
// Setup (F1) stands in front of it until the phone knows where the clinic
// server is, which on a shipped build is on first launch: `app.json` names no
// address, so there is nothing to probe and the fields open empty. A build
// carrying a default — a dev machine's, a clinic's own — probes it during the
// blank hold instead and goes straight to the shell if it answers. The hold
// covers reading the stored address off the device and that probe as well as
// the fonts, because mounting either screen before the answer is in flashes
// the wrong one.
export default function App() {
    const fontsLoaded = useAppFonts();
    const { ready, showSetup } = useServerSetup();
    // Before anything draws: the link a phone was launched by is only offered once.
    useJoinLinks();
    if (!fontsLoaded || !ready) return <View style={styles.screen} />;

    // `GestureHandlerRootView` and `BottomSheetModalProvider` are the two things
    // `ui/Sheet` needs above it: the first for the drag, the second because every
    // sheet is a modal presented into a portal here rather than mounted where it
    // is written. `GestureHandlerRootView` sits outside `SafeAreaProvider` so a
    // sheet can draw over the whole window, including the tab bar.
    //
    // `BottomSheetModalProvider` is *inside* `LocaleProvider` and `ApiProvider`,
    // and that nesting is load-bearing rather than tidy. The portal does not
    // carry context across: a sheet's children are re-parented into the host
    // rendered here, so every hook in them resolves against this position in the
    // tree and not against the screen that wrote the sheet. With the provider
    // above, `Sheet`'s own `useT` threw `LocaleProvider is missing` the moment a
    // sheet opened. The same move puts the host inside the provider's direction
    // wrapper, so sheet content mirrors in Arabic along with everything else.
    return (
        <GestureHandlerRootView style={styles.screen}>
            <SafeAreaProvider>
                <LocaleProvider>
                    <ApiProvider>
                        <BottomSheetModalProvider>
                            {/* The last resort, and the only boundary that can
                            catch the shell itself throwing. It sits under
                            `ApiProvider` so its Reload remounts the tree onto
                            the query cache that is already warm rather than
                            starting the app's connection over. Each pane has
                            its own boundary below this one, so reaching this
                            means the shell or the tab bar went, not a tab. */}
                            <LocalizedRoot showSetup={showSetup} />
                        </BottomSheetModalProvider>
                    </ApiProvider>
                </LocaleProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

function LocalizedRoot({ showSetup }: { showSetup: boolean }) {
    const clinic = useSyncExternalStore(subscribeToDataReset, clinicGeneration);
    const t = useT();
    const join = usePendingJoin();
    return (
        <ErrorBoundary
            title={t('The app stopped')}
            message={t(
                'Something went wrong and the screen could not be drawn. Reload to start again — nothing you saved has been lost.',
            )}
            onError={renderErrorReporter('root')}
        >
            <SafeAreaView style={styles.screen} edges={['top']}>
                {/* Above both screens, not inside either: a dev build says so
                    on the setup screen it opens on as well as on the day it
                    lands in. */}
                <DevBanner />
                {/* Keyed on the server a join link names, so a link that
                    arrives while setup is up fills it in. */}
                {showSetup ? <SetupScreen key={join?.server ?? ''} /> : <AppShell key={clinic} />}
                {/* Over both, last so it draws on top: a minor update takes the
                    whole screen until it has downloaded and restarted. */}
                <UpdateScreen />
                <StatusBar style="dark" />
            </SafeAreaView>
        </ErrorBoundary>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
});
