/**
 * Settings — one screen, not two: the doctor's rows are simply absent for the
 * secretary, and the admin's for everyone else. Which rows is the phone's view
 * (`shell/useRole`); what the phone may actually do is the server's to say,
 * from the role code it scanned. There is no navigator yet, so this screen is
 * its own stack (`src/navigation`) drawn with `ui/PushView`; lifting the panes into a real
 * navigator is `push` → `navigate`. The index is the root, and every pane sits
 * one deep on top of it — a pane's own editors push again from inside it.
 *
 * The index is a summary, not a menu. `settings.html` fills every row's sub
 * with that row's current answer — "default 30 min", "2 active · 1 inactive" —
 * so most questions are answered without opening anything, which is why the
 * screen loads all six summaries up front and shows skeleton rows rather than
 * drawing labels with empty subs under them.
 */
import { type ClientRole, leadDaysOf, managesClinic, type Role } from '@lustre/shared';
import { useQuery } from '@tanstack/react-query';
import { memo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import {
    allowsDemo,
    BUILD_VARIANT,
    disableLocalMode,
    driveClientId,
    type RouterOutput,
    resetDemoData,
    serverNow,
    useDemoMode,
    useDeviceBackend,
    useTRPC,
} from '../../api';
import { BrandMark, formatClock12 } from '../../components/domain';
import {
    Button,
    Card,
    CardDivider,
    PushView,
    ScreenHeader,
    SectionLabel,
    SegmentedControl,
    Toast,
    usePendingAction,
} from '../../components/ui';
// The store module directly, not the `shell` barrel: that barrel exports
// `AppShell`, which imports this screen.
import { setLocale, useLocale, useT } from '../../i18n';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { CRASH_REPORTS_ON, reportProblem } from '../../reporting';
import { BackupsNudge } from '../../shell/BackupsNudge';
import { setAdminView } from '../../shell/roleStore';
import { useRole } from '../../shell/useRole';
import { color, size, space, Text } from '../../theme';
import { AboutScreen } from './AboutScreen';
import { AppointmentsScreen } from './AppointmentsScreen';
import { AppScreen } from './AppScreen';
import { BackupsScreen } from './BackupsScreen';
import { BranchesScreen } from './BranchesScreen';
import { ClinicScreen } from './ClinicScreen';
import { DriveSignInSheet } from './components/DriveSignInSheet';
import { IdentityCard } from './components/IdentityCard';
import {
    DriveAlertIcon,
    EnterDemoIcon,
    LeaveDemoIcon,
    ReportProblemIcon,
    ResetDemoIcon,
    SettingsIcon,
} from './components/icons';
import { LanguageBlock } from './components/LanguageBlock';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { SettingsRow } from './components/SettingsRow';
import { DriveBackupsScreen } from './DriveBackupsScreen';
import { installedVersion, useApkUpdate } from './data/appUpdate';
import { versionLine } from './data/appVersion';
import { type BackupView, backupView, driveSignInError, localBackupLine } from './data/backups';
import { useConnectionView } from './data/connection';
import { useDriveSignIn } from './data/driveSignIn';
import { errorText } from './data/errors';
import { minutesFromTime } from './data/reminders';
import { PatientFieldsScreen } from './PatientFieldsScreen';
import { ProceduresScreen } from './ProceduresScreen';
import { RemindersScreen } from './RemindersScreen';
import { RolesScreen } from './RolesScreen';
import { ROLE_NAME, ScanCodeScreen } from './ScanCodeScreen';
import { WorkingHoursScreen } from './WorkingHoursScreen';

/** The panes over the index. The index itself is the root and is not one. */
type Route =
    | 'about'
    | 'app'
    | 'appointments'
    | 'backups'
    | 'driveBackups'
    | 'reminders'
    | 'clinic'
    | 'branches'
    | 'hours'
    | 'procedures'
    | 'patientFields'
    | 'scan'
    | 'roles';

const ROLE_INITIAL: Record<Role, string> = { admin: 'A', doctor: 'D', secretary: 'S' };

type SettingsScreenProps = {
    /**
     * Bumped when the fourth tab is tapped while it is already up. Home is the
     * index; the panes above it are all reads and settings already written, so
     * there is nothing in flight to protect.
     */
    goHome?: number;
};

function SettingsScreenView({ goHome = 0 }: SettingsScreenProps) {
    const [seenHome, setSeenHome] = useState(goHome);

    /**
     * The panes, and the hardware back with them. Nothing here answers back by
     * hand: the hook makes it `pop`, which is the same function the headers'
     * Back calls, so the two cannot come to disagree.
     *
     * What a pane has open inside itself stays the pane's own. An editor over
     * `ProceduresScreen` mounted after this stack did, and a handler that
     * mounted later is asked first, so it closes before this is reached.
     */
    const routes = useRouteStack<Route>();
    const back = routes.pop;

    if (goHome !== seenHome) {
        setSeenHome(goHome);
        routes.popToRoot();
    }

    const demo = useDemoMode();
    // A clinic on this phone alone: no server to connect, no other phone to
    // give a role, no backup job, and this phone is the desk.
    const local = useDeviceBackend().backend === 'local';

    // From the store rather than from a prop, like the locale below it: the
    // shell holds neither, and this screen is where both are changed.
    const { role, granted } = useRole();
    // The role card names what the phone was granted; a phone with no code yet
    // names the view it is still on.
    const shown: Role = granted ?? role;
    const locale = useLocale();
    const t = useT();

    const summary = useSummary();
    const connection = useConnectionView();
    const apkUpdate = useApkUpdate();
    const backups = useBackups();
    const localBackups = useLocalBackupLine(local);

    const driveSignIn = useDriveSignIn();
    const [linkingDrive, setLinkingDrive] = useState(false);

    /**
     * The confirm closes the sheet before Google's screen opens, so `linking`
     * — which only covers the last leg, the code exchange — is not what stops a
     * second tap launching a second `AuthSession`. The guard's ref is: it holds
     * from the tap to the account being linked, and clears on failure so the
     * sign-in can be tried again.
     */
    const link = usePendingAction(linkDrive);

    async function linkDrive() {
        setLinkingDrive(false);
        // `usePendingAction` swallows a rejection, so one that escapes the
        // sign-in is caught here and said, rather than clearing the spinner silently.
        const result = await driveSignIn
            .signIn()
            .catch(() => ({ kind: 'failed' as const, code: 'INTERNAL' }));
        if (result.kind === 'cancelled') return;
        setToast(
            result.kind === 'linked'
                ? result.account
                    ? t('Backups now go to {account}', { account: result.account })
                    : 'Google Drive linked'
                : driveSignInError(result.code),
        );
    }

    const isDoctor = role === 'doctor';
    // Setting the clinic up is the admin's (`managesClinic`); a phone with no
    // role code yet keeps what its view had before roles existed.
    const setsUp = granted ? managesClinic(granted) : isDoctor;

    const [toast, setToast] = useState<string | null>(null);
    const reports = CRASH_REPORTS_ON && !demo.enabled;

    function report() {
        const result = reportProblem();
        setToast(
            result.queued
                ? t('Report queued · ref {ref}', { ref: result.ref })
                : t('Problem reports are off on this build'),
        );
    }

    // The way back to the setup screen. The clinic is not touched: entering
    // again opens it as it was. Not behind the summary, like `about`: a clinic
    // file this phone cannot read must not also take away the way out of it.
    const leaveLocal = (
        <Group title={t('THIS PHONE ONLY')}>
            <SettingsRow
                icon={<LeaveDemoIcon />}
                label="Connect to a server"
                sub={t('The clinic on this phone stays here for when you come back')}
                onPress={() => {
                    void disableLocalMode();
                }}
                testID="settings-leave-local"
            />
        </Group>
    );

    // Not behind the summary either: the build is local, and it is what gets
    // read out over the phone when the server is not answering.
    const about = (
        <Group title={t('ABOUT')}>
            <SettingsRow
                icon={<SettingsIcon glyph="about" />}
                label="About"
                sub={`${t('Version')} ${INSTALLED.version ?? '0.0.0'}`}
                onPress={() => routes.push('about')}
                testID="settings-about"
            />
        </Group>
    );

    // Not behind the summary: a report is most wanted when the server is not
    // answering and the summary never loads.
    const problem = (
        <Group title={t('HELP')}>
            <SettingsRow
                icon={<ReportProblemIcon />}
                label={t('Report a problem')}
                sub={t(reports ? 'Sends your last taps, never patient details' : 'Off on this build')}
                onPress={report}
                testID="settings-report-problem"
            />
        </Group>
    );

    return (
        <View style={styles.screen}>
            <ScreenHeader
                title={t('Settings')}
                trailing={<BrandMark variant="lockup" size={13} tone="muted" />}
            />

            <IdentityCard
                roleName={ROLE_NAME[shown]}
                roleInitial={ROLE_INITIAL[shown]}
                clinicName={summary.data?.clinicName ?? ''}
                connection={connection}
                onScanCode={() => routes.push('scan')}
                solo={local}
                soloLine={localBackups}
                onOpenBackups={driveClientId() ? () => routes.push('driveBackups') : undefined}
                testID="settings-identity"
            />

            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                {local ? <BackupsNudge onOpen={() => routes.push('driveBackups')} /> : null}
                {/* A card in Settings, never a modal over the day: installing
                    leaves the app, and that is the doctor's call to make
                    between patients. The browser downloads it over the
                    tailnet and Android's installer takes it from there. */}
                {apkUpdate ? (
                    <Card padded style={styles.update} testID="settings-apk-update">
                        <View style={styles.updateText}>
                            <Text variant="body" weight="semibold">
                                {t('New version ready')}
                            </Text>
                            <Text variant="footnote" tone="muted">
                                {t('Lustre {version} (build {build}). Download it, then tap Install.', {
                                    version: apkUpdate.version,
                                    build: apkUpdate.versionCode,
                                })}
                            </Text>
                        </View>
                        <Button
                            label="Download"
                            size="md"
                            onPress={() => void Linking.openURL(apkUpdate.url)}
                            testID="settings-apk-download"
                        />
                    </Card>
                ) : null}

                {/* Above the summary, like the APK banner: the dump still runs
                    and still verifies when the grant dies, so nothing further
                    down this screen would look wrong. Drawn for the doctor
                    only — it is his Google account, and the CLINIC rows below
                    are gated the same way (§1: the role hides rows, it does
                    not guard anything). */}
                {setsUp && !local && backups?.tone === 'reauthorize' ? (
                    <Card padded style={styles.backupAlert} testID="settings-backup-alert">
                        <View style={styles.backupIcon}>
                            <DriveAlertIcon />
                        </View>
                        <View style={styles.updateText}>
                            <Text variant="body" weight="semibold">
                                {backups.sub}
                            </Text>
                            <Text variant="footnote" tone="muted">
                                {backups.detail}
                            </Text>
                        </View>
                    </Card>
                ) : null}

                {/* Above the summary and outside it: the language is this
                    phone's, so it answers whether or not the server does. */}
                <LanguageBlock locale={locale} onChange={setLocale} />

                {summary.loading ? <SkeletonRows count={3} /> : null}

                {summary.error ? (
                    <ErrorState
                        message={errorText(summary.error)}
                        onRetry={summary.reload}
                        retrying={summary.reloading}
                    />
                ) : null}

                {summary.data ? (
                    <>
                        <Group title={t('GENERAL')}>
                            {/* A clinic on this phone has no server to report on. */}
                            {local ? null : (
                                <>
                                    <SettingsRow
                                        icon={<SettingsIcon glyph="app" />}
                                        label="App"
                                        sub={t('Server connection')}
                                        onPress={() => routes.push('app')}
                                        testID="settings-app-row"
                                    />
                                    <CardDivider />
                                </>
                            )}
                            <SettingsRow
                                icon={<SettingsIcon glyph="appointments" />}
                                label="Appointments"
                                sub={t('Durations · default {minutes} min', {
                                    minutes: summary.data.defaultDuration,
                                })}
                                onPress={() => routes.push('appointments')}
                                testID="settings-appointments-row"
                            />
                            {/* The desk's work: the doctor's and the admin's
                                phones have no reminders. */}
                            {(isDoctor || granted === 'admin') && !local ? null : (
                                <>
                                    <CardDivider />
                                    <SettingsRow
                                        icon={<SettingsIcon glyph="reminders" />}
                                        label="Reminders"
                                        sub={t(
                                            leadDaysOf(summary.data.leadHours) === 1
                                                ? 'Due 1 day before · notify {time}'
                                                : 'Due {days} days before · notify {time}',
                                            {
                                                days: leadDaysOf(summary.data.leadHours),
                                                time: formatClock12(summary.data.notifyAt, locale),
                                            },
                                        )}
                                        onPress={() => routes.push('reminders')}
                                        testID="settings-reminders-row"
                                    />
                                </>
                            )}
                        </Group>

                        {setsUp ? (
                            <Group title={t('CLINIC')}>
                                <SettingsRow
                                    icon={<SettingsIcon glyph="clinic" />}
                                    label="Clinic"
                                    sub={t('Name, phone')}
                                    onPress={() => routes.push('clinic')}
                                    testID="settings-clinic-row"
                                />
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="branches" />}
                                    label="Branches"
                                    sub={t('{active} active · {inactive} inactive', {
                                        active: summary.data.activeBranches,
                                        inactive: summary.data.inactiveBranches,
                                    })}
                                    onPress={() => routes.push('branches')}
                                    testID="settings-branches"
                                />
                                <CardDivider />
                                {/* Not in `settings.html`, which never mentions opening hours; kept rather than delete a working screen. */}
                                <SettingsRow
                                    icon={<SettingsIcon glyph="hours" />}
                                    label="Working hours"
                                    sub={t('{count} days open', { count: summary.data.openDays })}
                                    onPress={() => routes.push('hours')}
                                    testID="settings-hours"
                                />
                                {/* A clinic on this phone has no backup job on a server:
                                    its backups go to its own Google Drive. */}
                                {local ? (
                                    driveClientId() ? (
                                        <>
                                            <CardDivider />
                                            <SettingsRow
                                                icon={<SettingsIcon glyph="backups" />}
                                                label="Backups"
                                                sub={localBackups}
                                                onPress={() => routes.push('driveBackups')}
                                                testID="settings-drive-backups"
                                            />
                                        </>
                                    ) : null
                                ) : (
                                    <>
                                        <CardDivider />
                                        <SettingsRow
                                            icon={<SettingsIcon glyph="backups" />}
                                            label="Backups"
                                            sub={backups?.sub ?? 'Checking…'}
                                            onPress={() => {
                                                if (!backups) return;
                                                // Nothing to report on until Drive is linked, so
                                                // the sign-in comes first when it can be run here.
                                                if (backups.canSignIn && !backups.linked)
                                                    setLinkingDrive(true);
                                                else routes.push('backups');
                                            }}
                                            testID="settings-backups"
                                        />
                                    </>
                                )}
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="procedures" />}
                                    label="Procedures & prices"
                                    sub={t('{count} procedures · {active} active', {
                                        count: summary.data.procedures,
                                        active: summary.data.activeProcedures,
                                    })}
                                    onPress={() => routes.push('procedures')}
                                    testID="settings-procedures"
                                />
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="fields" />}
                                    label="Patient fields"
                                    sub={t('{count} questions · {required} required', {
                                        count: summary.data.questions,
                                        required: summary.data.requiredQuestions,
                                    })}
                                    onPress={() => routes.push('patientFields')}
                                    testID="settings-patient-fields"
                                />
                            </Group>
                        ) : null}

                        {/* A clinic on this phone is always on the desk's day
                            (`useRole`) and has no other phone to give a role. */}
                        {granted === 'admin' && !local ? (
                            <Group title={t('ADMIN')}>
                                {/* Which day this phone shows. Screens only: the
                                    server still treats it as the admin, so Money
                                    and these settings stay either way. */}
                                <View style={styles.viewRow}>
                                    <Text variant="body" weight="semibold">
                                        {t('Day view')}
                                    </Text>
                                    <SegmentedControl<ClientRole>
                                        segments={[
                                            { value: 'doctor', label: 'Doctor' },
                                            { value: 'secretary', label: 'Secretary' },
                                        ]}
                                        value={role}
                                        onChange={setAdminView}
                                        accessibilityLabel="Day view"
                                        size="sm"
                                        testID="settings-admin-view"
                                    />
                                </View>
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="roles" />}
                                    label="Phones & role codes"
                                    sub={t('Give a phone its role, or withdraw it')}
                                    onPress={() => routes.push('roles')}
                                    testID="settings-roles"
                                />
                            </Group>
                        ) : null}

                        {/* Only in demo mode, and only here: a demo is given
                            more than once, and the second run should not open
                            on the first one's cancellations. `resetDemoData`
                            reports the reseed to `api/dataReset`, which is what
                            drops the clinic the query cache and the day view's
                            own hooks are still holding. */}
                        {local ? (
                            leaveLocal
                        ) : demo.enabled ? (
                            <Group title={t('DEMO')}>
                                <SettingsRow
                                    icon={<ResetDemoIcon />}
                                    label="Reset demo data"
                                    sub={t('Back to the clinic the demo opens on')}
                                    onPress={() => {
                                        void resetDemoData();
                                    }}
                                    testID="settings-reset-demo"
                                />
                                <CardDivider />
                                {/* The way back from the setup screen's demo
                                    button. Without it a phone that took the
                                    demo by mistake keeps writing into the fake
                                    register until its app data is cleared. */}
                                <SettingsRow
                                    icon={<LeaveDemoIcon />}
                                    label="Leave demo"
                                    sub={t('Connect to the clinic server instead')}
                                    onPress={() => {
                                        void demo.disable();
                                    }}
                                    testID="settings-leave-demo"
                                />
                            </Group>
                        ) : allowsDemo(BUILD_VARIANT) ? (
                            /* The setup screen's demo button, for a dev build
                               that is already connected: setup never shows
                               again once an address is saved, so this is the
                               only way in. The saved address stays put and
                               Leave demo above returns to it. A prod build
                               allows no demo, so its Settings never has this. */
                            <Group title={t('DEMO')}>
                                <SettingsRow
                                    icon={<EnterDemoIcon />}
                                    label="Enter demo"
                                    sub="A fake register, off the clinic server"
                                    onPress={() => {
                                        void demo.enable();
                                    }}
                                    testID="settings-enter-demo"
                                />
                            </Group>
                        ) : null}

                        {about}

                        {problem}

                        <Text variant="footnote" tone="muted" script="mono" style={styles.version}>
                            {versionLine(INSTALLED, locale)}
                        </Text>
                    </>
                ) : (
                    <>
                        {local ? leaveLocal : null}
                        {about}
                        {problem}
                    </>
                )}
            </ScrollView>

            <DriveSignInSheet
                visible={linkingDrive}
                account={backups?.account ?? null}
                busy={link.pending || driveSignIn.linking}
                onConfirm={link.run}
                onCancel={() => setLinkingDrive(false)}
            />

            {/* Nine near-identical blocks before the stack, each repeating its
                own route name three times. A popped pane stays in here until it
                reports the slide finished (`onClosed`), which is the only reason
                a route that is no longer open is still drawn. */}
            {rendered(routes.stack).map(({ id, route: pane }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={routes.settled}
                    testID={`settings-pane-${pane}`}
                >
                    {pane === 'about' ? <AboutScreen onBack={back} /> : null}
                    {pane === 'app' ? <AppScreen onBack={back} /> : null}
                    {pane === 'appointments' ? <AppointmentsScreen onBack={back} /> : null}
                    {pane === 'backups' ? (
                        <BackupsScreen
                            onBack={back}
                            onChangeAccount={backups?.canSignIn ? () => setLinkingDrive(true) : undefined}
                        />
                    ) : null}
                    {pane === 'driveBackups' ? <DriveBackupsScreen onBack={back} /> : null}
                    {pane === 'reminders' ? <RemindersScreen onBack={back} /> : null}
                    {pane === 'clinic' ? <ClinicScreen onBack={back} /> : null}
                    {pane === 'branches' ? <BranchesScreen onBack={back} /> : null}
                    {pane === 'hours' ? <WorkingHoursScreen onBack={back} /> : null}
                    {pane === 'procedures' ? <ProceduresScreen onBack={back} /> : null}
                    {pane === 'patientFields' ? <PatientFieldsScreen onBack={back} /> : null}
                    {pane === 'scan' ? (
                        <ScanCodeScreen
                            onBack={back}
                            onGranted={(next) => {
                                routes.popToRoot();
                                setToast(t('This phone is now {role}', { role: t(ROLE_NAME[next]) }));
                            }}
                        />
                    ) : null}
                    {pane === 'roles' ? <RolesScreen onBack={back} /> : null}
                </PushView>
            ))}

            {/* After the panes: a Drive sign-in started from the Backups pane
                reports here, and a toast under the pane would never be seen. */}
            <Toast
                visible={toast !== null}
                message={toast ?? ''}
                onDismiss={() => setToast(null)}
                testID="settings-toast"
            />
        </View>
    );
}

/** Memoised for the reason the other three clusters are — see `shell/AppShell.tsx`. */
export const SettingsScreen = memo(SettingsScreenView);

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.group}>
            <SectionLabel inset={false}>{title}</SectionLabel>
            <Card>{children}</Card>
        </View>
    );
}

/**
 * Everything the index's subs are counted from. Four reads go out together over
 * one batched request; the panes below read the same cache, so an edit in a
 * pane is on the index the moment it lands and nothing has to be handed back up
 * on the way out.
 *
 * The identity card names the clinic rather than the branch this phone is
 * standing in: nothing on the server tracks that yet, and a card that says the
 * wrong branch is worse than one that does not claim to know.
 */
/**
 * Polled rather than read once: the grant can die between two taps of the tab,
 * and the whole point of the card is that nothing else on the phone changes
 * when it does. Failure is silent — the connection card already says when the
 * server is not answering, and a second complaint about it is noise.
 */
function useBackups(): BackupView | null {
    const trpc = useTRPC();
    const t = useT();
    const status = useQuery(trpc.backup.status.queryOptions(undefined, { refetchInterval: 5 * 60_000 }));
    return status.data ? backupView(status.data, serverNow(), t) : null;
}

/** The status the card and the Backups row read, on a clinic kept on this phone. */
function useLocalBackupLine(local: boolean): string {
    const trpc = useTRPC();
    const t = useT();
    const status = useQuery(trpc.backup.status.queryOptions(undefined, { enabled: local }));
    return status.data ? localBackupLine(status.data, Date.now(), t) : t('Checking…');
}

function useSummary() {
    const trpc = useTRPC();

    const settings = useQuery(trpc.settings.get.queryOptions());
    const schedule = useQuery(trpc.settings.schedule.queryOptions());
    const branches = useQuery(trpc.branch.list.queryOptions({ includeInactive: true }));
    const procedures = useQuery(trpc.procedure.tree.queryOptions({ includeInactive: true }));
    const questions = useQuery(trpc.customQuestion.list.queryOptions({ includeInactive: true }));

    const reads = [settings, schedule, branches, procedures, questions];

    const data =
        settings.data && schedule.data && branches.data && procedures.data && questions.data
            ? summarize({
                  settings: settings.data,
                  schedule: schedule.data,
                  branches: branches.data,
                  procedures: procedures.data,
                  questions: questions.data,
              })
            : undefined;

    return {
        data,
        loading: reads.some((read) => read.isLoading),
        reloading: reads.some((read) => read.isFetching),
        error: reads.find((read) => read.error !== null)?.error ?? null,
        reload: () => {
            for (const read of reads) void read.refetch();
        },
    };
}

type SummaryInput = {
    settings: RouterOutput['settings']['get'];
    schedule: RouterOutput['settings']['schedule'];
    branches: RouterOutput['branch']['list'];
    procedures: RouterOutput['procedure']['tree'];
    questions: RouterOutput['customQuestion']['list'];
};

function summarize({ settings, schedule, branches, procedures, questions }: SummaryInput) {
    const flatProcedures = procedures.flatMap((node) => [node, ...node.children]);
    const activeQuestions = questions.filter((q) => q.active);

    return {
        clinicName: settings.clinicName,
        activeBranches: branches.filter((b) => b.active).length,
        inactiveBranches: branches.filter((b) => !b.active).length,
        openDays: schedule.length,
        procedures: flatProcedures.length,
        activeProcedures: flatProcedures.filter((p) => p.active).length,
        questions: activeQuestions.length,
        requiredQuestions: activeQuestions.filter((q) => q.required).length,
        defaultDuration: settings.defaultDuration,
        leadHours: settings.reminderLeadHours,
        notifyAt: minutesFromTime(settings.reminderNotifyAt),
    };
}

// The release this launch runs, the OTA update's number included.
const INSTALLED = installedVersion();

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    scroll: { flex: 1 },
    content: {
        paddingTop: space[4.5],
        paddingHorizontal: size.bleed,
        paddingBottom: space[12],
        gap: space[4.5],
    },
    group: { gap: space[2] },
    viewRow: { gap: space[2.5], padding: space[3.5] },
    version: { textAlign: 'center' },
    backupAlert: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        marginBottom: space[3],
        backgroundColor: color.dueSoft,
    },
    backupIcon: { paddingTop: space[0.5] },
    update: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    updateText: { flex: 1, gap: space[0.5] },
});
