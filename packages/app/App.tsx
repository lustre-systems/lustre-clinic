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

export default function App() {
    const fontsLoaded = useAppFonts();
    const { ready, showSetup } = useServerSetup();
    useJoinLinks();
    if (!fontsLoaded || !ready) return <View style={styles.screen} />;

    return (
        <GestureHandlerRootView style={styles.screen}>
            <SafeAreaProvider>
                <LocaleProvider>
                    <ApiProvider>
                        <BottomSheetModalProvider>
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
                <DevBanner />
                {showSetup ? <SetupScreen key={join?.server ?? ''} /> : <AppShell key={clinic} />}
                <UpdateScreen />
                <StatusBar style="dark" />
            </SafeAreaView>
        </ErrorBoundary>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
});
