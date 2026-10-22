import { seesPayments } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: schedules the tab warm-up through `InteractionManager` and cancels it on cleanup — work deliberately deferred past the first paint
import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';
import { useConnection, useCredential, useDeviceBackend } from '../api';
import { BottomTabBar, GLYPH, type TabKey } from '../components/domain';
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
import { MoneyCluster } from '../screens/money';
import { type OpenRecordRequest, PatientsCluster, useInvalidatePatients } from '../screens/patients';
import { SettingsScreen } from '../screens/settings';
import { color } from '../theme';
import { ApkUpdateBanner } from './ApkUpdateBanner';
import { type BackStack, type BackStacks, backFromRoot, createBackStacks } from './backStack';
import { JoinSheet } from './JoinSheet';
import { NotificationsBanner } from './NotificationsBanner';
import { OfflineScreen } from './OfflineScreen';
import { ProvisionScreen } from './ProvisionScreen';
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
import { useRole } from './useRole';

// The app shell (SPEC §18 F3): four clusters under one `domain/BottomTabBar`,
// each keeping its own internal stack. A tab is mounted on first open and then
// stays mounted, hidden with `display: 'none'` rather than unmounted, so the
// secretary keeps the date, scroll position and in-flight queries across tab
// switches. The role reaches the shell from `roleStore` rather than being held
// here: it outlives not just the settings screen but the process. It is still
// device-local and gates rows, never access.
//
// Four mounted clusters is also what makes the switch expensive if nothing is
// done about it: `setTab` re-renders this component, and every pane below it
// re-renders with it — the three nobody is about to look at included. So each
// cluster is `memo`'d and every prop that reaches one is stable, which leaves a
// tab switch costing this component, the four `Pane` wrappers and the tab bar.
// Nothing under a pane runs, because a switch changes nothing a pane is given.
// The rule that keeps it that way: no inline arrow, object or array may be
// written into a pane's props. It is worth reading `open` below with that in
// mind — it is handed to the tab bar, which is cheap, and deliberately is not
// one of these.
//
// It also owns every route that crosses clusters, because a cluster holds its
// own stack and cannot push into another one's. A patient's record is the
// oldest of them: wherever it is asked for — a row in the list, an appointment
// in the doctor's day view, a debtor on the money dashboard — it opens on the
// Patients tab and the tab bar moves with it, because that is the screen's home
// and a record drawn inside the Day tab left the highlight on a day nobody was
// looking at. The patient record's two openers go the other way, into the day
// cluster, for either role — and Back from the booking page they open comes
// back to the record, not to the day underneath it. All of them travel as
// requests (`shell/routes.ts`) and the destination decides which of its screens
// that means.
//
// Record payment was a third opener and is not routed at all any more. The
// server allocates a payment across a patient's unsettled visits, so there is
// no visit to go and pick and the sheet opens on the record in place.
//
// And it owns going home: tapping the tab you are already on pops that cluster
// back to its root. The shell cannot pop one from outside, so it bumps that
// tab's counter and the cluster resets itself.
//
// The hardware back is the same shape of problem answered the other way round.
// It arrives here, as one listener for the whole app, and the shell cannot pop
// a cluster from outside any more than it can send one home — so each pane
// carries a stack the screens inside it register with, and the shell asks the
// stack belonging to the tab that is up. What is left when nothing claims the
// press is the shell's own: the day, and then the launcher.
//
// Disconnected is the shell's other route (`ShellRoute`), not an overlay and
// not something each screen answers for itself. The panes stay mounted behind
// it, hidden the same way a tab that is not up is hidden, which is what lets
// the reconnect put her back on the day she was reading with her scroll and her
// caches intact — but nothing of them is drawn or tappable, because a search
// field over a server that cannot be searched is worse than no screen at all.
export function AppShell() {
    useClinicClock();
    const [tab, setTab] = useState<TabKey>('day');
    // Device-local and persisted (`roleStore`), not shell state: a role held
    // here only would be re-chosen as Doctor by every cold launch.
    const { hydrated: roleReady, role, granted } = useRole();
    // A doctor's phone has no Money tab and never mounts the cluster: every
    // read on it is one the server refuses that role.
    const money = seesPayments(granted);
    // The server would not let this phone in (`api/credential`). The route is
    // the connection's kind of answer, so it takes the panes' place the same way.
    const { refusal } = useCredential();
    // A code redeemed on the Money tab can take the tab away under her.
    if (!money && tab === 'money') setTab('day');
    const [visited, setVisited] = useState<TabKey[]>(['day']);
    // The day tab can be showing a booking, which is patients' work — the tab
    // bar says so rather than leaving the highlight on a day nobody is looking
    // at. Tapping a tab drops the highlight back where the tap says.
    const [booking, setBooking] = useState(false);
    // The request, not the route: the cluster below owns which of its screens is
    // up. `seq` makes each ask distinct, so the same patient can be opened again
    // after the record has been backed out of. One per destination — a booking
    // pushed into the day tab must not disturb the record the patients tab is
    // already holding.
    const [record, setRecord] = useState<OpenRecordRequest | undefined>(undefined);
    const [booked, setBooked] = useState<OpenBookingRequest | undefined>(undefined);
    // Tapping the tab you are already on. One counter per tab, bumped up here
    // and read down there, because only the cluster knows what its home is.
    const [home, setHome] = useState<HomeSignals>(NO_HOME);
    // Open reminders on the ringing alarm, the same kind of counter as `home`.
    const [remindersAsked, setRemindersAsked] = useState(0);
    // A toast for something that happened on one tab and finishes on another.
    // A cluster's own toast draws inside its pane, and the pane is hidden the
    // moment the route lands somewhere else — so a check-in that ends on the
    // patient's record has to report itself from up here.
    const [toast, setToast] = useState<string | null>(null);

    // The daily reminder nudge (§11). It belongs to the shell rather than to the
    // day cluster: it has to stay armed while the app sits on another tab or in
    // the background, and the day cluster is unmounted for neither of those but
    // is the wrong owner for something the whole app has.
    // Only on the desk's phone, and not before the role is known. A clinic on
    // this phone alone has no other phone to be the desk, so its admin is.
    const local = useDeviceBackend().backend === 'local';
    useReminderNudges(roleReady && role === 'secretary' && (granted !== 'admin' || local));
    // The doctor finishing (`visit:completed`), on the desk's phone only.
    useVisitCompletedNotices(roleReady ? role : null);
    // And its other half: Finish from the doctor's notification shade.
    useVisitFinishAction(roleReady ? role : null);
    // And the desk checking someone in (`appointment:checked_in`), on the doctor's phone.
    useArrivalNotices(roleReady ? role : null);
    useCrashReportRole(role);

    // Entered on the connection's word rather than on a query failing, so the
    // drop is answered wherever she is standing and not by whichever screen
    // happens to make the next request. `nextRoute` holds which statuses count,
    // and holding the route in state is what keeps it from flapping while
    // `reprobe` passes through 'probing' on its way to an answer.
    const { status } = useConnection();
    const [route, setRoute] = useState<ShellRoute>('app');
    const wanted = nextRoute(route, status);
    if (wanted !== route) setRoute(wanted);
    const disconnected = route === 'offline';
    const refused = !disconnected && refusal !== 'none';
    const away = disconnected || refused;

    // What the disconnected route draws when the server goes (`OfflineScreen`).
    // Written from here because the day panes may be on another date entirely.
    useSavedScheduleWriter(roleReady && refusal === 'none');

    // A pane nobody has opened has no components, so it has no queries either
    // and the round trip for Patients, Money or Settings started at the tap —
    // which is the pause. Mounting the other three once the day tab has settled
    // moves that cost to a moment when she is reading rather than waiting;
    // `runAfterInteractions` is what keeps it off the first paint. A tab tapped
    // before this lands still mounts on demand through `reveal`.
    useEffect(() => {
        const warm = InteractionManager.runAfterInteractions(() => setVisited([...ALL_TABS]));
        return () => warm.cancel();
    }, []);

    // Bringing a tab forward, without saying anything about the highlight — a
    // cross-cluster push answers that for itself, and the tab bar's own handler
    // answers it below.
    const reveal = useCallback((next: TabKey) => {
        noteScreen(next);
        setTab(next);
        setVisited((current) => (current.includes(next) ? current : [...current, next]));
    }, []);

    /**
     * The tab bar. A tap on the tab already showing is not a switch — it is
     * "take me back to the top of this tab", and the cluster is the only thing
     * that can do it.
     *
     * Measured against the tab actually up, not the one lit: while the day tab
     * shows a booking the highlight sits on Patients, and a tap there is a real
     * move to Patients rather than a reset of a tab nobody is on. A tap on Day
     * in that state closes the booking, which is what the highlight moving back
     * says it did.
     */
    function open(next: TabKey) {
        // Either way the booking page is not what the highlight is about
        // afterwards: a tap on Day sends the day cluster home, which closes it,
        // and a tap anywhere else leaves it behind.
        setBooking(false);
        if (next === tab) {
            setHome((current) => bumpHome(current, next));
            return;
        }
        reveal(next);
    }

    // Whatever was last on screen, the alarm asked for the list it is about.
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

    /**
     * The record's two openers. Both are one screen in the day cluster —
     * `BookingScreen`, where a walk-in is the "now" answer to when — so they
     * differ only in which answer it opens on.
     *
     * The highlight stays on Patients: the booking page covers the day pane, and
     * a booking belongs to the patient it is for. That is the same rule the day
     * tab's own FAB already follows, said here because the shell is what put the
     * page up.
     */
    const openBooking = useCallback(
        (patient: PatientTarget, timing: BookingTiming) => {
            setBooked((current) => ask(current, { patient, timing }));
            reveal('day');
            setBooking(true);
        },
        [reveal],
    );

    /**
     * The way back out of that booking page, whether it was left or finished.
     * The record never went anywhere — the Patients tab kept it — so going back
     * is bringing that tab up. Its data is the Patients cluster's own cache,
     * which no server event touches, so it is marked stale here or a booking
     * just made would be missing from the record it returns to.
     */
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

    // One per pane, rather than the arrow each `<Pane>` used to be written with.
    // The clusters are memoised and a tab switch changes none of their props, so
    // the switch costs a re-render of this component and nothing below it — but
    // only while every handler that reaches a pane keeps its identity. An inline
    // arrow here is a new prop on all four trees and puts the whole cascade back.
    const openFromDoctorDay = useCallback((patientId: string) => openRecord(patientId, 'Day'), [openRecord]);
    const openFromDay = useCallback(
        (patientId: string, said?: string, backLabel?: string) =>
            openRecord(patientId, backLabel ?? 'Day', said),
        [openRecord],
    );
    const openFromMoney = useCallback((patientId: string) => openRecord(patientId, 'Money'), [openRecord]);
    const bookLater = useCallback((patient: PatientTarget) => openBooking(patient, 'later'), [openBooking]);
    const clearToast = useCallback(() => setToast(null), []);

    /**
     * The hardware back — the button on a three-button bar, the edge swipe on a
     * gesture one. One listener for the whole app, here because the last word on
     * where it goes is the shell's.
     *
     * It is registered at mount and never again, which is what leaves it
     * underneath everything else: a sheet subscribes when it opens, and React
     * Native asks the newest listener first. So a sheet answers before this
     * does, and this is what is left when nothing else wanted the press.
     *
     * Then in the order she came in by. Down the pane's own stack first —
     * whatever it has pushed over its root (`backStack.ts`) — then out to the
     * day, which is where the app opens and so where back returns, and only from
     * the day's own root out of the app.
     *
     * Built lazily rather than as `useRef(createBackStacks())`, whose argument is
     * evaluated on every render for a value only the first one keeps. This
     * component re-renders on every tab switch.
     */
    const held = useRef<BackStacks | null>(null);
    held.current ??= createBackStacks();
    const stacks = held.current;

    useHardwareBack(true, () => {
        // The disconnected route is a dead end by design (`OfflineScreen`): no
        // tab bar, nothing behind it reachable. Back leaves the app rather than
        // being swallowed into a screen with one button on it.
        if (away) return false;
        if (stacks[tab].run()) return true;

        const home = backFromRoot(tab);
        if (home === null) return false;

        setBooking(false);
        reveal(home);
        return true;
    });

    // The same blank hold the root gives the fonts and the stored server
    // address, for the same reason: `role` decides which day screen and which
    // Settings rows exist, so drawing before the read lands shows one role the
    // other's screen for a frame.
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
                    {/* Over whichever day the role draws: the home screen is
                        where a clinic phone spends its day, so it is where a
                        new build gets noticed. */}
                    <NotificationsBanner />
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
                    tab="money"
                    visible={!away && tab === 'money'}
                    mounted={money && visited.includes('money')}
                    back={stacks.money}
                >
                    {/* The debtor rows are the whole tab now: tapping one opens
                        that patient's record, which is where a payment is taken.
                        Nothing pushes *into* this cluster any more. */}
                    <MoneyCluster goHome={home.money} onOpenRecord={openFromMoney} />
                </Pane>

                <Pane
                    tab="settings"
                    visible={!away && tab === 'settings'}
                    mounted={visited.includes('settings')}
                    back={stacks.settings}
                >
                    <SettingsScreen goHome={home.settings} />
                </Pane>

                {/* Inside the body rather than at the root, so it lands where a
                    cluster's own toast does: the top of the panes, clear of
                    the tab bar and every screen's bottom buttons.
                    It has nothing to say on the disconnected route: what it
                    reports happened on a tab, and no tab is up. */}
                <Toast
                    visible={!disconnected && toast !== null}
                    message={toast ?? ''}
                    onDismiss={clearToast}
                    testID="shell-toast"
                />

                {/* The route, in the panes' place rather than over them: they
                    are hidden above, so this is the only thing in the body. */}
                {disconnected ? <OfflineScreen /> : null}
                {refused ? <ProvisionScreen refusal={refusal} /> : null}
                {/* Over any route but offline: a phone the server refuses is
                    exactly the one a join link is for. */}
                {disconnected ? null : <JoinSheet onDone={setToast} />}
            </View>

            {/* No tab bar on the disconnected route either. It is a dead end,
                not a mode to navigate around, and every tab it offers leads to
                the same screen. */}
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

/**
 * One tab, and one boundary around it. A cluster that throws costs its own tab
 * and nothing else: the tab bar stays up and the other three still work, which
 * is the difference between "the day view is broken" and "the app is dead".
 *
 * Reloading is offered twice over. The fallback's own button is the direct
 * answer, and `resetKey` is the indirect one — leaving the tab and coming back
 * clears a boundary that has tripped, so a broken tab is never a state the app
 * is stuck in. Both land the cluster at its own root either way: the tree was
 * unmounted when the boundary tripped, and its route state went with it.
 *
 * Tapping the tab you are already on does *not* clear it. That signal is read
 * by the cluster, and a tripped cluster is not mounted to hear anything.
 */
function Pane({
    tab,
    visible,
    mounted,
    back,
    children,
}: {
    /** Which tab, for the crash report the boundary sends. */
    tab: TabKey;
    visible: boolean;
    mounted: boolean;
    /** This tab's back handlers. One object for the life of the app, so the
     *  context below never changes value and no cluster re-renders for it. */
    back: BackStack;
    children: React.ReactNode;
}) {
    if (!mounted) return null;
    return (
        <View style={[styles.pane, !visible && styles.hidden]} pointerEvents={visible ? 'auto' : 'none'}>
            <BackStackContext.Provider value={back}>
                <ErrorBoundary
                    title="This tab stopped"
                    message="Something on this tab went wrong. The other tabs still work — reload this one to try again."
                    icon={<GLYPH.problem size={22} color={color.ink2} strokeWidth={2} />}
                    resetKey={visible}
                    onError={renderErrorReporter(tab)}
                >
                    {children}
                </ErrorBoundary>
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
