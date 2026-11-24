import { memo, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
    Banner,
    Button,
    PushView,
    RefreshView,
    SegmentedControl,
    Toast,
    useAfterSheet,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { color, size, space } from '../../theme';
import { PatientEditScreen } from '../patients/PatientEditScreen';
import { procedureLabel, splitDay } from './agenda';
import { CALENDAR_CLOSED, type CalendarState, closeCalendar, openCalendar } from './calendar';
import { type Standing, splitDeskDay } from './chair';
import { BeforeThis, UpNext } from './components/Agenda';
import { AppointmentDetailSheet } from './components/AppointmentDetailSheet';
import { BookFab } from './components/BookFab';
import { BookingScreen } from './components/BookingScreen';
import { BookNextSheet } from './components/BookNextSheet';
import { BookPatientSheet } from './components/BookPatientSheet';
import { CalendarSheet } from './components/CalendarSheet';
import { ClosedDay } from './components/ClosedDay';
import { DayHeader } from './components/DayHeader';
import { useDayLastDone } from './components/DayLastDone';
import { DayEmpty, DayError, DaySkeleton } from './components/DayStates';
import { ChatIcon, ClockIcon } from './components/icons';
import { LateNotice } from './components/LateNotice';
import { NowCard } from './components/NowCard';
import { Reminders } from './components/Reminders';
import { VisitPaymentScreen } from './components/VisitPaymentScreen';
import { VisitScreen } from './components/VisitScreen';
import { VisitViewScreen } from './components/VisitViewScreen';
import { pickBranch, scheduledBranch, usePickedBranch } from './currentBranch';
import {
    type Appointment,
    api,
    checkInTimes,
    type EmbeddedPatient,
    type Patient,
    useLocalMutation,
    useLocalQuery,
    type Visit,
    visitForAppointment,
} from './data';
import { dayDelay, delayLabel } from './delay';
import { describeError } from './errors';
import { isClosed } from './hours';
import { pricedVisit } from './money';
import { busiestBranch, holdsSlot } from './month';
import { draftFor, type PatientDraft } from './patientDraft';
import { relativeDayLabel, todayKey } from './time';
import { useNowMinutes } from './useNow';

type DayTab = 'day' | 'reminders';

type Route =
    | {
          name: 'booking';
          patient: PatientDraft;
          timing?: 'now' | 'later';
          from?: 'record';
      }
    | { name: 'reschedule'; appointment: Appointment }
    | { name: 'view' }
    | { name: 'treatment' }
    | { name: 'payment' }
    | { name: 'registerPatient' };

export type OpenBookingRequest = {
    patient: Patient;
    timing: 'now' | 'later';
    seq: number;
};

type DayScreenProps = {
    onBookingChange?: (open: boolean) => void;
    onOpenRecord?: (patientId: string, said?: string, backLabel?: string) => void;
    open?: OpenBookingRequest;
    onReturn?: (said?: string) => void;
    goHome?: number;
    showReminders?: number;
};

function DayScreenView({
    onBookingChange,
    onOpenRecord,
    open,
    onReturn,
    goHome = 0,
    showReminders = 0,
}: DayScreenProps = {}) {
    const t = useT();
    const [dateKey, setDateKey] = useState(todayKey);
    const [tab, setTab] = useState<DayTab>('day');
    const branchId = usePickedBranch();
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    const [booking, setBooking] = useState({ open: false, seq: 0 });
    const [registering, setRegistering] = useState(false);
    const [paying, setPaying] = useState(false);
    const [seenOpen, setSeenOpen] = useState(open?.seq ?? 0);
    const [seenHome, setSeenHome] = useState(goHome);
    const [seenReminders, setSeenReminders] = useState(showReminders);
    const [selected, setSelected] = useState<{ appointment: Appointment | null; open: boolean }>({
        appointment: null,
        open: false,
    });
    const [visit, setVisit] = useState<{
        appointment: Appointment;
        visit: Visit | null;
        origin: 'view' | 'arrival' | 'checkout';
        standing: Standing | null;
        seq: number;
    } | null>(null);
    const payable = visit?.visit ? pricedVisit(visit.visit) : null;
    const [bookNext, setBookNext] = useState<{
        patient: EmbeddedPatient;
        seated: string;
        seq: number;
    } | null>(null);
    const [bookNextOpen, setBookNextOpen] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const bookNextDone = useAfterSheet();
    const detailDone = useAfterSheet();

    const routes = useRouteStack<Route>({
        locked: registering || paying,
        backFrom: (route) => route.name === 'booking' && route.from === 'record' && returnToRecord(),
    });

    function returnToRecord(said?: string): boolean {
        if (!onReturn) return false;
        routes.clear();
        onReturn(said);
        return true;
    }

    if (open && open.seq !== seenOpen) {
        setSeenOpen(open.seq);
        setBooking((current) => ({ ...current, open: false }));
        routes.resetTo({
            name: 'booking',
            patient: draftFor(open.patient),
            timing: open.timing,
            from: 'record',
        });
    }

    const homeAsked = goHome !== seenHome;
    const remindersAsked = showReminders !== seenReminders;
    if ((homeAsked || remindersAsked) && !registering && !paying) {
        setSeenHome(goHome);
        setSeenReminders(showReminders);
        setTab(remindersAsked ? 'reminders' : 'day');
        routes.popToRoot();
        setBookNextOpen(false);
        setBooking((current) => ({ ...current, open: false }));
        setCalendar(closeCalendar);
        setSelected((current) => ({ ...current, open: false }));
    }

    function pushPage(route: Route) {
        routes.push(route);
        const under = routes.stack.open.some((entry) => entry.route.name === 'booking');
        onBookingChange?.(route.name === 'booking' || under);
    }

    function resetToPage(route: Route) {
        routes.resetTo(route);
        onBookingChange?.(route.name === 'booking');
    }

    function replaceTopPage(route: Route) {
        routes.replaceTop(route);
        const under = routes.stack.open.some((entry) => entry.route.name === 'booking');
        onBookingChange?.(route.name === 'booking' || under);
    }

    const nowMinutes = useNowMinutes();

    const schedule = useLocalQuery('schedule', api.schedule);
    const settings = useLocalQuery('settings', api.settings);
    const branches = useLocalQuery('branches', api.branches);
    const day = useLocalQuery(`day:${dateKey}`, () => api.byDate(dateKey));
    const history = useDayLastDone({
        goHome,
        covered: routes.stack.open.length > 0 || toast !== null || bookNextOpen,
        onOpenRecord,
        onChanged: () => day.refetch(),
    });
    const clinicDay = day.data ?? [];
    const branch =
        branchId ??
        scheduledBranch(dateKey, schedule.data) ??
        busiestBranch(clinicDay.filter(holdsSlot), null) ??
        branches.data?.[0]?.id ??
        null;

    const reminders = useLocalQuery('reminders', () => api.pendingReminders());
    const reminderCount = reminders.data?.length ?? 0;

    const openRow = useLocalMutation(visitForAppointment);
    const noShow = useLocalMutation(api.markNoShow);

    const appointments = clinicDay.filter((row) => row.branchId === branch && row.status !== 'cancelled');
    const closed = isClosed(dateKey, schedule.data, branch);

    const away = clinicDay.filter((row) => row.branchId !== branch && holdsSlot(row));
    const awayId = busiestBranch(away, null);
    const awayName = (branches.data ?? []).find((row) => row.id === awayId)?.name;
    const elsewhere =
        awayId && awayName
            ? {
                  name: awayName,
                  count: away.filter((row) => row.branchId === awayId).length,
                  onGo: () => pickBranch(awayId),
              }
            : undefined;
    const isToday = dateKey === todayKey();

    const checkedInIds = useMemo(
        () =>
            appointments
                .filter((row) => row.status === 'checked_in')
                .map((row) => row.id)
                .sort(),
        [appointments],
    );
    const arrivals = useLocalQuery(`arrivals:${checkedInIds.join(',')}`, () => checkInTimes(checkedInIds), {
        enabled: checkedInIds.length > 0,
    });

    const seatFor = (id: string) => arrivals.data?.inChairAt.get(id) ?? arrivals.data?.checkedInAt.get(id);

    const reads = [day, schedule, branches, reminders, arrivals];
    const pull = usePullToRefresh(
        () => {
            day.refetch();
            schedule.refetch();
            branches.refetch();
            reminders.refetch();
            if (checkedInIds.length > 0) arrivals.refetch();
        },
        reads.some((read) => read.refreshing || read.status === 'loading'),
    );

    const { chair, waiting, desk, next, card } = useMemo(
        () => splitDeskDay(appointments, arrivals.data?.checkedInAt),
        [appointments, arrivals.data],
    );

    const active = desk ?? chair;

    const { past, upcoming } = splitDay(appointments, isToday ? (card?.id ?? null) : null, isToday);

    const delay = useMemo(
        () => dayDelay(appointments, isToday ? nowMinutes : null, arrivals.data?.checkedInAt),
        [appointments, isToday, nowMinutes, arrivals.data],
    );

    const lateText = delayLabel(delay);
    const [lateDismissed, setLateDismissed] = useState(false);
    if (lateDismissed && !lateText) setLateDismissed(false);

    const pickDay = (nextDate: string, nextBranch: string | null) => {
        setDateKey(nextDate);
        if (nextBranch) pickBranch(nextBranch);
    };

    const openBooking = () => setBooking((current) => ({ open: true, seq: current.seq + 1 }));

    function openDetail(appointment: Appointment) {
        const live = appointment.status === 'awaiting_payment' || appointment.status === 'checked_in';
        const finished = appointment.status === 'done';
        if (!live && !finished) {
            setSelected({ appointment, open: true });
            return;
        }

        openRow.mutate(appointment.id, {
            onSuccess: (loaded) => {
                if (loaded) {
                    openVisit(appointment, loaded, finished ? 'view' : 'checkout');
                    return;
                }
                setSelected({ appointment, open: true });
            },
        });
    }

    const checkingInId = null;

    function openVisit(
        appointment: Appointment,
        loaded: Visit | null,
        origin: 'view' | 'arrival' | 'checkout' = 'checkout',
    ) {
        setVisit((current) => ({
            appointment,
            visit: loaded,
            origin,
            standing: standingOf(appointment),
            seq: (current?.seq ?? 0) + 1,
        }));
        if (origin === 'view') resetToPage({ name: 'view' });
        else resetToPage({ name: 'treatment' });
    }

    function standingOf(appointment: Appointment): Standing {
        if (appointment.status === 'done' || !isToday) return 'finished';
        if (appointment.status === 'awaiting_payment') return 'desk';
        return chair?.id === appointment.id ? 'chair' : 'waiting';
    }

    function seated(): string {
        return chair ? t('waiting, {count} ahead', { count: waiting.length + 1 }) : t('in the chair');
    }

    function stayOnDay(patient: EmbeddedPatient, standing: string) {
        setBookNextOpen(false);
        setToast(t('{name} is {standing}', { name: patient.name, standing }));
    }

    function bookNextOn(patient: EmbeddedPatient) {
        setBookNextOpen(false);
        bookNextDone.after(() => {
            pushPage({ name: 'booking', patient: draftFor(patient), timing: 'later' });
        });
    }

    function checkInFrom(appointment: Appointment) {
        openVisit(appointment, null, 'arrival');
    }

    function offerBookNext(patient: EmbeddedPatient) {
        setBookNext((current) => ({ patient, seated: seated(), seq: (current?.seq ?? 0) + 1 }));
        setBookNextOpen(true);
    }

    function markNoShow(appointment: Appointment) {
        noShow.mutate(appointment.id, {
            onSuccess: () => {
                setToast(t('{name} marked as a no-show', { name: appointment.patient.name }));
                day.refetch();
            },
        });
    }

    return (
        <View style={styles.screen}>
            <DayHeader
                dateKey={dateKey}
                branches={branches.data ?? []}
                branchId={branch}
                onPickBranch={pickBranch}
                onOpenCalendar={() => setCalendar(openCalendar)}
                history={history.button}
            />

            {reminderCount > 0 || tab === 'reminders' ? (
                <View style={styles.tabs}>
                    <SegmentedControl<DayTab>
                        accessibilityLabel="Day or reminders"
                        value={tab}
                        onChange={setTab}
                        segments={[
                            {
                                value: 'day',
                                label: `${relativeDayLabel(dateKey)} · ${appointments.length}`,
                                icon: (selected) => (
                                    <ClockIcon size={15} stroke={selected ? color.ink : color.ink2} />
                                ),
                            },
                            {
                                value: 'reminders',
                                label: `${t('Reminders')} · ${reminderCount}`,
                                icon: (selected) => (
                                    <ChatIcon size={15} stroke={selected ? color.ink : color.ink2} />
                                ),
                            },
                        ]}
                    />
                </View>
            ) : null}

            {day.status === 'error' && day.error && appointments.length > 0 ? (
                <Banner
                    tone="offline"
                    live
                    message={t('{problem} — showing the day as it was.', {
                        problem: describeError(day.error, 'day').title,
                    })}
                />
            ) : null}
            {schedule.error !== null && schedule.status !== 'success' ? (
                <Banner
                    tone="warning"
                    message="Opening hours could not be loaded — showing the usual hours."
                    action={
                        <Button
                            label="Try again"
                            variant="text"
                            size="md"
                            onPress={schedule.refetch}
                            loading={schedule.status === 'loading'}
                        />
                    }
                />
            ) : null}
            {openRow.error ? (
                <Banner
                    tone="warning"
                    message={t('{problem} — the visit could not be opened.', {
                        problem: describeError(openRow.error).title,
                    })}
                />
            ) : null}
            {noShow.error ? <Banner tone="warning" message={describeError(noShow.error).title} /> : null}

            <View style={styles.body}>
                {tab === 'reminders' ? (
                    <Reminders
                        query={reminders}
                        pull={pull}
                        onOpenRecord={
                            onOpenRecord && ((patientId) => onOpenRecord(patientId, undefined, 'Reminders'))
                        }
                    />
                ) : day.status === 'loading' ? (
                    <DaySkeleton />
                ) : day.status === 'error' && day.error && appointments.length === 0 ? (
                    <RefreshView pull={pull}>
                        <DayError error={day.error} onRetry={day.refetch} />
                    </RefreshView>
                ) : closed ? (
                    <ClosedDay
                        dateKey={dateKey}
                        appointments={appointments}
                        chairId={isToday ? (chair?.id ?? null) : null}
                        onSelect={openDetail}
                        pull={pull}
                    />
                ) : appointments.length === 0 ? (
                    <RefreshView pull={pull}>
                        <DayEmpty past={dateKey < todayKey()} elsewhere={elsewhere} />
                    </RefreshView>
                ) : (
                    <ScrollView
                        contentContainerStyle={styles.agenda}
                        showsVerticalScrollIndicator={false}
                        refreshControl={pull.refreshControl}
                        {...pull.scrollProps}
                        testID="day-agenda"
                    >
                        {isToday ? <BeforeThis appointments={past} onSelect={openDetail} /> : null}

                        {lateText && !lateDismissed ? (
                            <LateNotice
                                late={lateText}
                                gap={AGENDA_GAP}
                                onDismissed={() => setLateDismissed(true)}
                            />
                        ) : null}

                        {isToday ? (
                            <NowCard
                                active={active}
                                next={next}
                                nowMinutes={nowMinutes}
                                procedure={card ? procedureLabel(card) : undefined}
                                seatedAt={active ? seatFor(active.id) : undefined}
                                checkingInId={checkingInId}
                                onCheckIn={checkInFrom}
                                onOpen={openDetail}
                                onOpenRecord={(patientId) => onOpenRecord?.(patientId)}
                            />
                        ) : null}

                        <UpNext
                            appointments={upcoming}
                            chairId={isToday ? (chair?.id ?? null) : null}
                            delay={delay}
                            nowMinutes={isToday ? nowMinutes : null}
                            relativeToNow={isToday}
                            checkingInId={checkingInId}
                            onSelect={openDetail}
                            onCheckIn={checkInFrom}
                            onNoShow={markNoShow}
                        />
                    </ScrollView>
                )}
            </View>

            {tab === 'day' ? <BookFab onPress={openBooking} /> : null}

            <CalendarSheet
                key={`calendar:${calendar.seq}`}
                visible={calendar.open}
                selected={dateKey}
                schedule={schedule.data}
                branches={branches.data ?? []}
                branchId={branch}
                onPick={pickDay}
                onClose={() => setCalendar(closeCalendar)}
            />

            <BookPatientSheet
                key={`book-patient:${booking.seq}`}
                visible={booking.open}
                onClose={() => setBooking((current) => ({ ...current, open: false }))}
                onPicked={(patient) => {
                    setBooking((current) => ({ ...current, open: false }));
                    pushPage({ name: 'booking', patient });
                }}
                onRegisterNew={() => {
                    setBooking((current) => ({ ...current, open: false }));
                    pushPage({ name: 'registerPatient' });
                }}
            />

            <AppointmentDetailSheet
                key={`detail:${selected.appointment?.id ?? 'none'}`}
                visible={selected.open}
                appointment={
                    clinicDay.find((row) => row.id === selected.appointment?.id) ?? selected.appointment
                }
                inChair={isToday && chair !== null && chair.id === selected.appointment?.id}
                onClose={() => setSelected((current) => ({ ...current, open: false }))}
                onChanged={day.refetch}
                onCheckIn={(appointment) => detailDone.after(() => checkInFrom(appointment))}
                onReschedule={(appointment) =>
                    detailDone.after(() => pushPage({ name: 'reschedule', appointment }))
                }
                onCheckOut={(appointment, loaded) => {
                    setSelected((current) => ({ ...current, open: false }));
                    detailDone.after(() => openVisit(appointment, loaded));
                }}
                onOpenRecord={(appointment) => detailDone.after(() => onOpenRecord?.(appointment.patient.id))}
                onClosed={detailDone.closed}
            />

            {bookNext ? (
                <BookNextSheet
                    key={`book-next:${bookNext.seq}`}
                    visible={bookNextOpen}
                    patientName={bookNext.patient.name}
                    onBookNow={() => bookNextOn(bookNext.patient)}
                    onLater={() => stayOnDay(bookNext.patient, bookNext.seated)}
                    onClosed={bookNextDone.closed}
                />
            ) : null}

            {rendered(routes.stack).map(({ id, route }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={() => {
                        routes.settled();
                        if (route.name === 'booking') onBookingChange?.(false);
                    }}
                    testID={`day-${route.name}-page`}
                >
                    {route.name === 'registerPatient' ? (
                        <PatientEditScreen
                            key={`register:${id}`}
                            onCancel={routes.pop}
                            onSavingChange={setRegistering}
                            onSaved={(patientId, basics) => {
                                if (!basics) {
                                    routes.pop();
                                    return;
                                }
                                replaceTopPage({
                                    name: 'booking',
                                    patient: draftFor({ id: patientId, ...basics }),
                                });
                            }}
                        />
                    ) : null}

                    {route.name === 'booking' ? (
                        <BookingScreen
                            patient={route.patient}
                            timing={route.timing}
                            branchId={branch}
                            branches={branches.data ?? []}
                            schedule={schedule.data}
                            durationOptions={settings.data?.durationOptions ?? [15, 30, 45]}
                            defaultDuration={settings.data?.defaultDuration ?? 30}
                            dateKey={dateKey}
                            nowMinutes={nowMinutes}
                            onBack={routes.back}
                            onBooked={(message) => {
                                day.refetch();
                                if (route.from === 'record' && returnToRecord(message)) return;
                                routes.pop();
                                setToast(message);
                            }}
                        />
                    ) : null}

                    {route.name === 'reschedule' ? (
                        <BookingScreen
                            patient={draftFor(route.appointment.patient)}
                            rescheduling={route.appointment}
                            branchId={route.appointment.branchId}
                            branches={branches.data ?? []}
                            schedule={schedule.data}
                            durationOptions={settings.data?.durationOptions ?? [15, 30, 45]}
                            defaultDuration={route.appointment.durationMinutes}
                            dateKey={dateKey}
                            nowMinutes={nowMinutes}
                            onBack={routes.pop}
                            onBooked={(message) => {
                                routes.pop();
                                setToast(message);
                                day.refetch();
                            }}
                            onCancelled={(message) => {
                                routes.pop();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}

                    {route.name === 'view' && visit?.visit ? (
                        <VisitViewScreen
                            key={`view:${visit.seq}`}
                            appointment={visit.appointment}
                            visit={visit.visit}
                            onBack={routes.pop}
                            onEdit={() => pushPage({ name: 'treatment' })}
                            onDeleted={() => {
                                routes.popToRoot();
                                setToast('Visit deleted.');
                                day.refetch();
                            }}
                            onPaymentDeleted={(updated) => {
                                setVisit({ ...visit, visit: updated });
                                day.refetch();
                            }}
                        />
                    ) : null}

                    {route.name === 'treatment' && visit ? (
                        <VisitScreen
                            key={`visit:${visit.seq}`}
                            appointment={visit.appointment}
                            visit={visit.visit ?? undefined}
                            mode={visit.origin === 'arrival' ? 'arrival' : 'checkout'}
                            standing={visit.standing ?? undefined}
                            onBack={routes.pop}
                            onNoteSaved={(note) =>
                                setVisit((current) =>
                                    current
                                        ? {
                                              ...current,
                                              appointment: { ...current.appointment, note },
                                          }
                                        : current,
                                )
                            }
                            onConfirm={(priced) => {
                                if (visit.origin === 'arrival') {
                                    routes.popToRoot();
                                    day.refetch();
                                    offerBookNext(visit.appointment.patient);
                                    return;
                                }
                                if (visit.standing === 'waiting') {
                                    routes.popToRoot();
                                    setToast(
                                        t('{name} is still waiting', {
                                            name: visit.appointment.patient.name,
                                        }),
                                    );
                                    day.refetch();
                                    return;
                                }
                                setVisit((current) => (current ? { ...current, visit: priced } : current));
                                pushPage({ name: 'payment' });
                            }}
                            onSentToDesk={(message) => {
                                routes.popToRoot();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}

                    {route.name === 'payment' && visit && payable ? (
                        <VisitPaymentScreen
                            key={`payment:${visit.seq}:${payable.chargedTotal}`}
                            appointment={visit.appointment}
                            visit={payable}
                            correcting={visit.standing === 'finished'}
                            onWritingChange={setPaying}
                            onBack={routes.pop}
                            onClosed={(message) => {
                                routes.popToRoot();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}
                </PushView>
            ))}

            {history.layer}

            <Toast visible={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} />
        </View>
    );
}

export const DayScreen = memo(DayScreenView);

const AGENDA_GAP = space[3];

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    body: { flex: 1 },
    agenda: { paddingBottom: size.nav, gap: AGENDA_GAP },
    tabs: { paddingHorizontal: size.gutter, paddingBottom: space[3] },
});
