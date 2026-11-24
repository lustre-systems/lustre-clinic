import { memo, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
    Banner,
    Button,
    PushView,
    RefreshView,
    Toast,
    useAfterSheet,
    usePullToRefresh,
} from '../../components/ui';
import { useT } from '../../i18n';
import { isOpen, rendered, useRouteStack } from '../../navigation';
import { color, size, space } from '../../theme';
import { procedureLabel } from './agenda';
import { CALENDAR_CLOSED, type CalendarState, closeCalendar, openCalendar } from './calendar';
import { type Standing, splitDoctorDay } from './chair';
import { BeforeThis } from './components/Agenda';
import { BookingScreen } from './components/BookingScreen';
import { CalendarSheet } from './components/CalendarSheet';
import { ChairCard, type ChairCardKind, ChairStrip } from './components/Chair';
import { ClosedDay } from './components/ClosedDay';
import { DayHeader } from './components/DayHeader';
import { useDayLastDone } from './components/DayLastDone';
import { DayEmpty, DayError, DaySkeleton } from './components/DayStates';
import { AfterThis } from './components/DoctorAgenda';
import { DoctorVisitSheet } from './components/DoctorVisitSheet';
import { FinishSheet } from './components/FinishSheet';
import { VisitScreen } from './components/VisitScreen';
import { pickBranch, scheduledBranch, usePickedBranch } from './currentBranch';
import type { OpenBookingRequest } from './DayScreen';
import {
    type Appointment,
    api,
    checkInTimes,
    useLocalMutation,
    useLocalQuery,
    type Visit,
    visitForAppointment,
} from './data';
import { describeError } from './errors';
import { finishPress } from './finish';
import { isClosed } from './hours';
import { formatMoney } from './money';
import { busiestBranch, holdsSlot } from './month';
import { draftFor } from './patientDraft';
import { todayKey } from './time';
import { useNowMinutes } from './useNow';

type DoctorDayScreenProps = {
    onOpenRecord: (patientId: string) => void;
    open?: OpenBookingRequest;
    onReturn?: (said?: string) => void;
    goHome?: number;
};

function DoctorDayScreenView({ onOpenRecord, open, onReturn, goHome = 0 }: DoctorDayScreenProps) {
    const t = useT();
    const [dateKey, setDateKey] = useState(todayKey);
    const branchId = usePickedBranch();
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    const [seenHome, setSeenHome] = useState(goHome);
    const [opened, setOpened] = useState<{ appointment: Appointment | null; sheet: boolean }>({
        appointment: null,
        sheet: false,
    });
    const [toast, setToast] = useState<string | null>(null);
    const [editing, setEditing] = useState<{
        appointment: Appointment;
        visit: Visit;
        standing: Standing;
        finishing: boolean;
        seq: number;
    } | null>(null);
    const [asking, setAsking] = useState<{ appointment: Appointment | null; open: boolean }>({
        appointment: null,
        open: false,
    });
    const [moving, setMoving] = useState<Appointment | null>(null);
    const [seenOpen, setSeenOpen] = useState(open?.seq ?? 0);
    const routes = useRouteStack<'treatment' | 'reschedule' | 'booking'>({
        backFrom: (route) => route === 'booking' && returnToRecord(),
    });
    const loadVisit = useLocalMutation(visitForAppointment);
    const sheetDone = useAfterSheet();

    function returnToRecord(said?: string): boolean {
        if (!onReturn) return false;
        routes.clear();
        onReturn(said);
        return true;
    }

    if (open && open.seq !== seenOpen) {
        setSeenOpen(open.seq);
        setOpened((current) => ({ ...current, sheet: false }));
        setAsking((current) => ({ ...current, open: false }));
        routes.resetTo('booking');
    }

    if (goHome !== seenHome) {
        setSeenHome(goHome);
        setOpened((current) => ({ ...current, sheet: false }));
        setAsking((current) => ({ ...current, open: false }));
        setCalendar(closeCalendar);
        routes.popToRoot();
    }

    const nowMinutes = useNowMinutes();

    const schedule = useLocalQuery('schedule', api.schedule);
    const branches = useLocalQuery('branches', api.branches);
    const settings = useLocalQuery('settings', api.settings);
    const day = useLocalQuery(`day:${dateKey}`, () => api.byDate(dateKey));
    const history = useDayLastDone({
        goHome,
        covered: routes.stack.open.length > 0 || toast !== null,
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

    const appointments = useMemo(
        () => clinicDay.filter((row) => row.branchId === branch && row.status !== 'cancelled'),
        [clinicDay, branch],
    );
    const closed = isClosed(dateKey, schedule.data, branch);
    const isToday = dateKey === todayKey();

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

    const reads = [day, schedule, branches, arrivals];
    const pull = usePullToRefresh(
        () => {
            day.refetch();
            schedule.refetch();
            branches.refetch();
            if (checkedInIds.length > 0) arrivals.refetch();
        },
        reads.some((read) => read.refreshing || read.status === 'loading'),
    );

    const { chair, headline, strip, list, past } = useMemo(
        () => splitDoctorDay(appointments, arrivals.data?.checkedInAt),
        [appointments, arrivals.data],
    );

    const finish = useLocalMutation(api.awaitPayment);
    const [finishing, setFinishing] = useState<string | null>(null);
    const finishingId = finish.pending ? finishing : null;

    const kind: ChairCardKind =
        headline === null
            ? 'next'
            : headline === chair
              ? 'chair'
              : headline.status === 'checked_in'
                ? 'waiting'
                : 'next';

    const openVisit = (appointment: Appointment) => setOpened({ appointment, sheet: true });

    const pickDay = (nextDate: string, nextBranch: string | null) => {
        setDateKey(nextDate);
        if (nextBranch) pickBranch(nextBranch);
    };

    function standingOf(appointment: Appointment): Standing {
        if (appointment.status === 'done' || !isToday) return 'finished';
        if (appointment.status === 'awaiting_payment') return 'desk';
        return chair?.id === appointment.id ? 'chair' : 'waiting';
    }

    const closeFinishSheet = () => setAsking((current) => ({ ...current, open: false }));

    function recordVisit(appointment: Appointment, finishing = false) {
        if (loadVisit.pending) return;
        loadVisit.mutate(appointment.id, {
            onSuccess: (loaded) => {
                if (!loaded) {
                    closeFinishSheet();
                    setToast('This visit could not be found');
                    return;
                }
                setEditing((current) => ({
                    appointment,
                    visit: loaded,
                    standing: standingOf(appointment),
                    finishing,
                    seq: (current?.seq ?? 0) + 1,
                }));
                setOpened((current) => ({ ...current, sheet: false }));
                closeFinishSheet();
                sheetDone.after(() => routes.resetTo('treatment'));
            },
            onError: closeFinishSheet,
        });
    }

    function editBooking(appointment: Appointment) {
        setMoving(appointment);
        setOpened((current) => ({ ...current, sheet: false }));
        sheetDone.after(() => routes.resetTo('reschedule'));
    }

    function pressFinish(appointment: Appointment) {
        const press = finishPress(settings.data?.askToEditOnFinish, finish.pending || loadVisit.pending);
        if (press === 'finish') finishVisit(appointment);
        if (press === 'ask') setAsking({ appointment, open: true });
    }

    function finishVisit(appointment: Appointment) {
        if (finish.pending) return;
        setFinishing(appointment.id);
        finish.mutate(appointment.id, {
            onSuccess: () => {
                setToast(t('{name} is at the desk', { name: appointment.patient.name }));
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
            {finish.error ? <Banner tone="warning" message={describeError(finish.error).title} /> : null}
            {loadVisit.error ? (
                <Banner
                    tone="warning"
                    message={t('{problem} — the visit could not be opened.', {
                        problem: describeError(loadVisit.error).title,
                    })}
                />
            ) : null}

            <View style={styles.body}>
                {day.status === 'loading' ? (
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
                        onSelect={openVisit}
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
                        testID="doctor-agenda"
                    >
                        {isToday ? <BeforeThis appointments={past} onSelect={openVisit} /> : null}

                        {isToday && strip ? (
                            <ChairStrip
                                appointment={strip}
                                procedure={procedureLabel(strip)}
                                seatedAt={seatFor(strip.id)}
                                finishing={finishingId === strip.id}
                                onOpen={openVisit}
                                onOpenRecord={onOpenRecord}
                                onFinish={pressFinish}
                            />
                        ) : null}

                        {isToday ? (
                            <ChairCard
                                appointment={headline}
                                kind={kind}
                                nowMinutes={nowMinutes}
                                procedure={headline ? procedureLabel(headline) : undefined}
                                checkedInAt={
                                    headline ? arrivals.data?.checkedInAt.get(headline.id) : undefined
                                }
                                seatedAt={headline ? seatFor(headline.id) : undefined}
                                finishing={finishingId === headline?.id}
                                onOpenRecord={onOpenRecord}
                                onOpen={openVisit}
                                onFinish={pressFinish}
                            />
                        ) : null}

                        <AfterThis
                            appointments={isToday ? list : appointments}
                            relativeToNow={isToday}
                            onSelect={openVisit}
                        />
                    </ScrollView>
                )}
            </View>

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

            <DoctorVisitSheet
                visible={opened.sheet}
                appointment={opened.appointment}
                inChair={isToday && chair !== null && chair.id === opened.appointment?.id}
                onClose={() => setOpened((current) => ({ ...current, sheet: false }))}
                onOpenRecord={(appointment) => {
                    setOpened((current) => ({ ...current, sheet: false }));
                    onOpenRecord(appointment.patientId);
                }}
                onRecord={recordVisit}
                onEditBooking={editBooking}
                recording={loadVisit.pending}
                onClosed={sheetDone.closed}
            />

            <FinishSheet
                visible={asking.open}
                patientName={asking.appointment?.patient.name ?? ''}
                loading={loadVisit.pending}
                onEdit={() => {
                    if (asking.appointment) recordVisit(asking.appointment, true);
                }}
                onFinish={() => {
                    closeFinishSheet();
                    if (asking.appointment) finishVisit(asking.appointment);
                }}
                onClose={closeFinishSheet}
                onClosed={sheetDone.closed}
            />

            {rendered(routes.stack).map(({ id, route }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={routes.settled}
                    testID={`doctor-${route}-page`}
                >
                    {route === 'booking' && open ? (
                        <BookingScreen
                            patient={draftFor(open.patient)}
                            timing={open.timing}
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
                                if (returnToRecord(message)) return;
                                routes.popToRoot();
                                setToast(message);
                            }}
                        />
                    ) : null}

                    {route === 'reschedule' && moving ? (
                        <BookingScreen
                            key={`reschedule:${moving.id}`}
                            patient={draftFor(moving.patient)}
                            rescheduling={moving}
                            branchId={moving.branchId}
                            branches={branches.data ?? []}
                            schedule={schedule.data}
                            durationOptions={settings.data?.durationOptions ?? [15, 30, 45]}
                            defaultDuration={moving.durationMinutes}
                            dateKey={dateKey}
                            nowMinutes={nowMinutes}
                            onBack={routes.pop}
                            onBooked={(message) => {
                                routes.popToRoot();
                                setToast(message);
                                day.refetch();
                            }}
                        />
                    ) : null}

                    {route === 'treatment' && editing ? (
                        <VisitScreen
                            key={`visit:${editing.seq}`}
                            appointment={editing.appointment}
                            visit={editing.visit}
                            mode="checkout"
                            standing={editing.standing}
                            finishing={editing.finishing}
                            onBack={routes.pop}
                            onConfirm={(priced) => {
                                routes.popToRoot();
                                setToast(
                                    t('Saved · {amount}', { amount: formatMoney(priced.chargedTotal ?? 0) }),
                                );
                                day.refetch();
                            }}
                            onSentToDesk={(message) => {
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

export const DoctorDayScreen = memo(DoctorDayScreenView);

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    body: { flex: 1 },
    agenda: { paddingBottom: size.nav, gap: space[3] },
});
