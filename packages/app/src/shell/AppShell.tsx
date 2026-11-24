// biome-ignore lint/style/noRestrictedImports: schedules the tab warm-up through `InteractionManager` and cancels it on cleanup — work deliberately deferred past the first paint
import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';
import { useConnection, useCredential, useDeviceBackend } from '../api';
import { BottomTabBar, GLYPH, showsStats, type TabKey } from '../components/domain';
import { ErrorBoundary, Toast, useHardwareBack } from '../components/ui';
import {
    useAlarmOpen,
    useArrivalNotices,
    useReminderNudges,
    useVisitCompletedNotices,
    useVisitFinishAction,
} from '../notifications';
import { noteScreen, renderErrorReporter, useCrashReportRole } from '../reporting';
import { DayScreen, DoctorDayScreen, type OpenBookingRequest, useSavedScheduleWriter } from '../screens/day';
import { type OpenRecordRequest, PatientsCluster, useInvalidatePatients } from '../screens/patients';
import { SettingsScreen } from '../screens/settings';
import { StatsScreen } from '../screens/stats';
import { color } from '../theme';
import { ApkUpdateBanner } from './ApkUpdateBanner';
import { BackupsNudge } from './BackupsNudge';
import { type BackStack, type BackStacks, backFromRoot, createBackStacks } from './backStack';
import { JoinSheet } from './JoinSheet';
import { NotificationsBanner } from './NotificationsBanner';
import { OfflineScreen } from './OfflineScreen';
import { ProvisionScreen } from './ProvisionScreen';
import { PaneVisibleContext } from './paneVisible';
import {
    ALL_TABS,
    ask,
    type BookingTiming,
    bumpHome,
    type HomeSignals,
    NO_HOME,
    nextRoute,
    type PatientTarget,
    type ShellRoute,
} from './routes';
import { BackStackContext } from './useBackHandler';
import { useClinicClock } from './useClinicClock';
import { useDailyDriveBackup } from './useDailyDriveBackup';
import { useRole } from './useRole';

export function AppShell() {
    useClinicClock();
    const [tab, setTab] = useState<TabKey>('day');
    const { hydrated: roleReady, role, granted } = useRole();
    const stats = showsStats(granted, granted ?? role);
    const { refusal } = useCredential();
    if (!stats && tab === 'stats') setTab('day');
    const [visited, setVisited] = useState<TabKey[]>(['day']);
    const [booking, setBooking] = useState(false);
    const [record, setRecord] = useState<OpenRecordRequest | undefined>(undefined);
    const [booked, setBooked] = useState<OpenBookingRequest | undefined>(undefined);
    const [home, setHome] = useState<HomeSignals>(NO_HOME);
    const [remindersAsked, setRemindersAsked] = useState(0);
    const [toast, setToast] = useState<string | null>(null);

    const local = useDeviceBackend().backend === 'local';
    useDailyDriveBackup(local);
    useReminderNudges(roleReady && role === 'secretary' && (granted !== 'admin' || local));
    useVisitCompletedNotices(roleReady ? role : null);
    useVisitFinishAction(roleReady ? role : null);
    useArrivalNotices(roleReady ? role : null);
    useCrashReportRole(role);

    const { status } = useConnection();
    const [route, setRoute] = useState<ShellRoute>('app');
    const wanted = nextRoute(route, status);
    if (wanted !== route) setRoute(wanted);
    const disconnected = route === 'offline';
    const refused = !disconnected && refusal !== 'none';
    const away = disconnected || refused;

    useSavedScheduleWriter(roleReady && refusal === 'none');

    useEffect(() => {
        const warm = InteractionManager.runAfterInteractions(() => setVisited([...ALL_TABS]));
        return () => warm.cancel();
    }, []);

    const reveal = useCallback((next: TabKey) => {
        noteScreen(next);
        setTab(next);
        setVisited((current) => (current.includes(next) ? current : [...current, next]));
    }, []);

    function open(next: TabKey) {
        setBooking(false);
        if (next === tab) {
            setHome((current) => bumpHome(current, next));
            return;
        }
        reveal(next);
    }

    const openReminders = useCallback(() => {
        setBooking(false);
        reveal('day');
        setRemindersAsked((n) => n + 1);
    }, [reveal]);
    useAlarmOpen(openReminders, roleReady);

    const openRecord = useCallback(
        (patientId: string, backLabel?: string, said?: string) => {
            setRecord((current) => ask(current, { patientId, backLabel }));
            reveal('patients');
            setBooking(false);
            if (said) setToast(said);
        },
        [reveal],
    );

    const openBooking = useCallback(
        (patient: PatientTarget, timing: BookingTiming) => {
            setBooked((current) => ask(current, { patient, timing }));
            reveal('day');
            setBooking(true);
        },
        [reveal],
    );

    const invalidatePatients = useInvalidatePatients();
    const returnToRecord = useCallback(
        (said?: string) => {
            reveal('patients');
            setBooking(false);
            invalidatePatients();
            if (said) setToast(said);
        },
        [reveal, invalidatePatients],
    );

    const openFromDoctorDay = useCallback((patientId: string) => openRecord(patientId, 'Day'), [openRecord]);
    const openFromDay = useCallback(
        (patientId: string, said?: string, backLabel?: string) =>
            openRecord(patientId, backLabel ?? 'Day', said),
        [openRecord],
    );
    const bookLater = useCallback((patient: PatientTarget) => openBooking(patient, 'later'), [openBooking]);
    const clearToast = useCallback(() => setToast(null), []);

    const held = useRef<BackStacks | null>(null);
    held.current ??= createBackStacks();
    const stacks = held.current;

    useHardwareBack(true, () => {
        if (away) return false;
        if (stacks[tab].run()) return true;

        const home = backFromRoot(tab);
        if (home === null) return false;

        setBooking(false);
        reveal(home);
        return true;
    });

    if (!roleReady) return <View style={styles.root} />;

    return (
        <View style={styles.root}>
            <View style={styles.body}>
                <Pane
                    tab="day"
                    visible={!away && tab === 'day'}
                    mounted={visited.includes('day')}
                    back={stacks.day}
                >
                    <NotificationsBanner />
                    {local ? <BackupsNudge onOpen={() => setTab('settings')} snoozable /> : null}
                    <ApkUpdateBanner />
                    {role === 'doctor' ? (
                        <DoctorDayScreen
                            key="doctor"
                            open={booked}
                            goHome={home.day}
                            onOpenRecord={openFromDoctorDay}
                            onReturn={returnToRecord}
                        />
                    ) : (
                        <DayScreen
                            key="secretary"
                            open={booked}
                            goHome={home.day}
                            showReminders={remindersAsked}
                            onBookingChange={setBooking}
                            onOpenRecord={openFromDay}
                            onReturn={returnToRecord}
                        />
                    )}
                </Pane>

                <Pane
                    tab="patients"
                    visible={!away && tab === 'patients'}
                    mounted={visited.includes('patients')}
                    back={stacks.patients}
                >
                    <PatientsCluster open={record} goHome={home.patients} onBook={bookLater} />
                </Pane>

                <Pane
                    tab="stats"
                    visible={!away && tab === 'stats'}
                    mounted={stats && visited.includes('stats')}
                    back={stacks.stats}
                >
                    <StatsScreen goHome={home.stats} onScreen={!away && tab === 'stats'} />
                </Pane>

                <Pane
                    tab="settings"
                    visible={!away && tab === 'settings'}
                    mounted={visited.includes('settings')}
                    back={stacks.settings}
                >
                    <SettingsScreen goHome={home.settings} />
                </Pane>

                <Toast
                    visible={!disconnected && toast !== null}
                    message={toast ?? ''}
                    onDismiss={clearToast}
                    testID="shell-toast"
                />

                {disconnected ? <OfflineScreen /> : null}
                {refused ? <ProvisionScreen refusal={refusal} /> : null}
                {disconnected ? null : <JoinSheet onDone={setToast} />}
            </View>

            {away ? null : (
                <BottomTabBar
                    active={booking && tab === 'day' ? 'patients' : tab}
                    role={granted ?? role}
                    granted={granted}
                    solo={local}
                    onChange={open}
                />
            )}
        </View>
    );
}

function Pane({
    tab,
    visible,
    mounted,
    back,
    children,
}: {
    tab: TabKey;
    visible: boolean;
    mounted: boolean;
    back: BackStack;
    children: React.ReactNode;
}) {
    if (!mounted) return null;
    return (
        <View style={[styles.pane, !visible && styles.hidden]} pointerEvents={visible ? 'auto' : 'none'}>
            <BackStackContext.Provider value={back}>
                <PaneVisibleContext.Provider value={visible}>
                    <ErrorBoundary
                        title="This tab stopped"
                        message="Something on this tab went wrong. The other tabs still work — reload this one to try again."
                        icon={<GLYPH.problem size={22} color={color.ink2} strokeWidth={2} />}
                        resetKey={visible}
                        onError={renderErrorReporter(tab)}
                    >
                        {children}
                    </ErrorBoundary>
                </PaneVisibleContext.Provider>
            </BackStackContext.Provider>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.canvas },
    body: { flex: 1 },
    pane: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
    hidden: { display: 'none' },
});
