/**
 * A booking, once the patient is known: what it is for, when it is, and a last
 * look before anything is written. The FAB used to open a walk-in and nothing
 * else, which made the day view a screen you could only add to *now* — the
 * phone call asking for Thursday had nowhere to go. So the walk-in became one
 * answer to "when" (`appointment.walkIn`, booked and checked in on arrival —
 * seated now, or at the end of the procedure already in the chair) and a time
 * on a later day became the other (`appointment.create`).
 *
 * A page rather than a sheet: a plan of procedures, a fortnight of days and a
 * grid of times do not fit above a keyboard. Who it is for is still asked in a
 * sheet (`BookPatientSheet`) — a search box and a short list is what a sheet is
 * good at — and answering it pushes this. The pane sits inside the day tab, so
 * Back returns to the day with its date, branch and scroll intact; the shell
 * lights the Patients tab while it is open, because that is the part of the
 * app this belongs to.
 *
 * The order of the questions is the order of the conversation at the desk:
 * what needs doing, then when they can come, then read it back. Nothing is
 * written until the last step's button. The clinic PC is across Tailscale, so a
 * refusal lands above that button in the words of what was being attempted
 * (§4/§14) — never a toast that slides away while the patient is standing there.
 *
 * Rescheduling is this page too (`rescheduling`). A patient who rings to move
 * used to be cancelled and booked again, which lost the ref, the plan and the
 * note and wrote a cancellation into their history. A move asks the same three
 * questions, seeded from the appointment: its plan and note, then When on its
 * own day, branch and length. The time may be kept, so an edit to what they are
 * booked for is not forced to be a move. Its button calls `appointment.update`
 * with only what changed, and the reminder moves with a new start on the server.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { serverNow } from '../../../api';
import { MoneyValue, ToothGroupCard } from '../../../components/domain';
import {
    Button,
    Callout,
    Chevron,
    Chip,
    Select,
    StepView,
    Textarea,
    useKeyboardHeight,
} from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import {
    dayLabel,
    daysOffered,
    fortnightSlots,
    settleBookingDay,
    slotIsFree,
    timeLabel,
    withoutAppointment,
} from '../booking';
import { CALENDAR_CLOSED, type CalendarState, closeCalendar, openCalendar } from '../calendar';
import {
    type Appointment,
    api,
    type Branch,
    type ClinicDay,
    useGeneralClinic,
    useLocalMutation,
    useLocalQuery,
} from '../data';
import { describeError } from '../errors';
import { isClosed } from '../hours';
import { formatMoney } from '../money';
import { noteChanged, noteDraft, noteValue } from '../notes';
import { type PatientDraft, patientNameOf, patientPhoneOf, patientRefOf } from '../patientDraft';
import {
    bookedProcedures,
    groupByTooth,
    type PlannedProcedure,
    planFrom,
    samePlan,
    toothPosition,
    totalOf,
} from '../procedures';
import {
    addDays,
    clinicOffsetNow,
    dateKey as dayKeyOf,
    dayOfMonth,
    isoAt,
    minutesOfDay,
    monthShort,
    offsetForDate,
    relativeDayLabel,
    time12,
    todayKey,
} from '../time';
import { CalendarSheet } from './CalendarSheet';
import { CalendarIcon, DurationIcon, LabIcon, PatientIcon, PinIcon } from './icons';
import { LabSwitch } from './LabWork';
import { ProcedurePlan } from './ProcedurePlan';
import { SlotPicker } from './SlotPicker';
import { Steps, SummaryRow } from './Steps';

export type BookingScreenProps = {
    /** Answered by `BookPatientSheet`, or handed straight in by a screen that
     * already has the patient — the patient record books this way. */
    patient: PatientDraft;
    /**
     * Which answer to "when" the page opens on. Set by a caller that has already
     * asked the question — the record's Walk-in means now and its Book means a
     * day to be chosen. Left off, the day on screen decides, which is what the
     * FAB wants.
     */
    timing?: Timing;
    /**
     * The appointment being moved, when this is a reschedule and not a new
     * booking. `patient`, `branchId` and `defaultDuration` are expected to be
     * its own; the day it opens on is its own too, whatever `dateKey` says.
     */
    rescheduling?: Appointment;
    branchId: string | null;
    branches: readonly Branch[];
    schedule: readonly ClinicDay[] | undefined;
    durationOptions: readonly number[];
    defaultDuration: number;
    /** The day the screen behind is on — where a scheduled booking opens. */
    dateKey: string;
    /** Minutes into today: what "now" means, and which times have gone. */
    nowMinutes: number;
    onBack: () => void;
    onBooked: (message: string) => void;
};

/**
 * How far ahead the day strip offers without being asked. Anything past it is
 * reached by name through the calendar — see `daysOffered`.
 */
const STRIP_DAYS = 14;

/** The floating dock's button and its padding — what the scroll has to clear. */
const BAR_HEIGHT = space[3] + size.button + space[4];

type Step = 'what' | 'when' | 'confirm';
type Timing = 'now' | 'later';

const STEPS: { key: Step; label: string }[] = [
    { key: 'what', label: 'Procedures' },
    { key: 'when', label: 'When' },
    { key: 'confirm', label: 'Confirm' },
];

export function BookingScreen({
    patient,
    timing: asked,
    rescheduling,
    branchId,
    branches,
    schedule,
    durationOptions,
    defaultDuration,
    dateKey,
    nowMinutes,
    onBack,
    onBooked,
}: BookingScreenProps) {
    const t = useT();
    const today = todayKey();

    const [index, setIndex] = useState(0);
    const [plan, setPlan] = useState<PlannedProcedure[]>([]);
    // A move's plan is the appointment's, filled in once the catalogue can
    // price it. Until then there is nothing to compare, so nothing has changed.
    const [planSeeded, setPlanSeeded] = useState(rescheduling === undefined);
    // A move opens on the day the appointment already has, not the day behind.
    const movingFrom = rescheduling ? dayKeyOf(rescheduling.startsAt) : null;
    const openOn = movingFrom ?? dateKey;
    const [timing, setTiming] = useState<Timing>(
        asked ?? (!isClosed(today, schedule, branchId) && dateKey === today ? 'now' : 'later'),
    );
    const [date, setDate] = useState(openOn < today ? today : openOn);
    /**
     * A day past the strip's window, asked for by name — seeded from the day
     * the screen behind was on, and replaced whenever the calendar answers.
     *
     * Without it, opening a booking from a day months out threw that day away
     * before the desk saw the form: the day was not in the window, so the guard
     * below moved the picker to the first day that was, and the only sign of it
     * was the tile at the top quietly reading today.
     */
    const [farDay, setFarDay] = useState<string | null>(
        openOn > addDays(today, STRIP_DAYS - 1) ? openOn : null,
    );
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    // A move opens with the time it already has picked, so the grid shows where
    // the booking is now rather than an empty question it would answer anyway.
    const [slotMinutes, setSlotMinutes] = useState<number | null>(
        rescheduling ? minutesOfDay(rescheduling.startsAt) : null,
    );
    const [duration, setDuration] = useState(defaultDuration);
    const [note, setNote] = useState(() => noteDraft(rescheduling?.note));
    // A new booking only: a move keeps the lab state it has, and the detail
    // sheet is where that is changed.
    const [needsLab, setNeedsLab] = useState(false);
    const [branch, setBranch] = useState<string | null>(branchId);
    // The dock floats over the scroll, so the body reserves its height — and that
    // height is not a constant. A warning above the bar wraps to as many lines as
    // its text needs, and two of them can show at once, so a fixed inset leaves
    // the end of the content under a notice at full scroll. `BAR_HEIGHT` is the
    // bare bar, which is what the dock measures to before the first layout.
    const [dockHeight, setDockHeight] = useState(BAR_HEIGHT);
    const keyboard = useKeyboardHeight();

    // A walk-in is always "now", whatever day the screen behind is on — the only
    // thing that rules it out is a branch that is not working today. It moves
    // with the branch, because Maadi being open is not Nasr City being open.
    const canWalkIn = !isClosed(today, schedule, branch);
    const branchName = branches.find((row) => row.id === branch)?.name ?? null;

    const walkIn = useLocalMutation(api.walkIn);
    const create = useLocalMutation(api.create);
    const move = useLocalMutation(api.reschedule);

    const step = STEPS[index]?.key ?? 'confirm';
    // Picking a branch that is not working today takes the walk-in away under
    // the choice already made, so "now" falls back to a time rather than
    // leaving a booking with no when at all.
    // A move is always to a time: a walk-in is a new arrival, not this booking.
    const scheduled = rescheduling !== undefined || timing === 'later' || !canWalkIn;
    const pending = walkIn.pending || create.pending || move.pending;
    const error = rescheduling ? move.error : scheduled ? create.error : walkIn.error;
    const failure = error
        ? describeError(error, rescheduling ? 'move' : scheduled ? 'booking' : 'walk-in')
        : null;

    // The length it was booked for stays offered even if Settings has since
    // dropped it: a move that only changes the time must not force a new length.
    const lengths =
        rescheduling && !durationOptions.includes(rescheduling.durationMinutes)
            ? [...durationOptions, rescheduling.durationMinutes].sort((a, b) => a - b)
            : durationOptions;
    const wasLabel =
        rescheduling && movingFrom
            ? `${dayLabel(movingFrom)} · ${timeLabel(minutesOfDay(rescheduling.startsAt))}`
            : null;

    const ref = patientRefOf(patient);
    const name = patientNameOf(patient);

    const catalogue = useLocalQuery('procedure-tree', api.procedureTree);
    const general = useGeneralClinic();

    // Set during render rather than in an effect, as `VisitScreen` seeds its
    // checkup: the plan is on screen in the commit the catalogue lands in.
    if (!planSeeded && rescheduling && catalogue.data) {
        setPlanSeeded(true);
        setPlan(planFrom(rescheduling.procedures, catalogue.data));
    }

    // Every day the branch works in the fortnight ahead, not just the one on
    // screen: "which days can take a 45-minute visit" cannot be answered from a
    // single day, and a strip offering a day whose every time is gone is the
    // same lie the slot grid used to tell. One request either way — `byDates`
    // batches over `httpBatchLink` — and the day being booked reads its times
    // out of the same answer, so the grid and the Book button cannot disagree.
    const workingDays = useMemo(
        () => daysOffered(today, STRIP_DAYS, farDay, schedule, branch),
        [today, farDay, schedule, branch],
    );

    const fortnight = useLocalQuery(
        `booking-days:${branch}:${workingDays.join(',')}`,
        () => api.byDates(workingDays),
        { enabled: scheduled && workingDays.length > 0 },
    );

    // The appointment being moved does not hold a slot against itself — see
    // `withoutAppointment`. Memoized so `fortnightSlots` below keeps its cache.
    const fetched = useMemo(
        () => withoutAppointment(fortnight.data, rescheduling?.id),
        [fortnight.data, rescheduling?.id],
    );

    // `enabled: false` leaves the query at `success` with no data, and a key
    // change clears data a frame before the fetch starts, so neither status
    // alone is the question: the question is whether the rows are in hand.
    // `fortnightSlots` answers nothing until they are — and only the days that
    // can actually take a visit this long come back as open, so asking for 45
    // minutes on a full Thursday takes Thursday off the strip rather than
    // leaving it there to be tapped and found empty.
    const { slotsByDay, openDays } = useMemo(
        () =>
            fortnightSlots({
                days: workingDays,
                fetched,
                schedule,
                branchId: branch,
                durationMinutes: duration,
                today,
                nowMinutes,
            }),
        [fetched, workingDays, schedule, branch, duration, today, nowMinutes],
    );

    // The grid steps from opening time by the visit's length, so the time a
    // booking already has is often not one of its cells: a 45-minute visit at
    // 10:00 on a day opening at 9:00 falls between 9:45 and 10:30. A move puts
    // its own time back on its own day so the page opens with it picked and
    // visible, and keeps that day on the strip even when nothing else is free.
    const bookedAt = rescheduling ? minutesOfDay(rescheduling.startsAt) : null;
    const daySlots = slotsByDay.get(date) ?? [];
    const slots =
        bookedAt !== null && date === movingFrom && !daySlots.some((slot) => slot.minutes === bookedAt)
            ? [...daySlots, { minutes: bookedAt, state: 'free' as const, runsLate: false }].sort(
                  (a, b) => a.minutes - b.minutes,
              )
            : daySlots;
    const movable =
        movingFrom && !openDays.includes(movingFrom) && workingDays.includes(movingFrom)
            ? [...openDays, movingFrom].sort()
            : openDays;

    // Asking for a longer visit can take the day in hand off the strip, and the
    // booking lands on the first day that can still take it — unless the day
    // was picked from the calendar, which stays picked and says it has no times
    // (`settleBookingDay`). Adjusted during render, not in an effect: `openDays`
    // does not depend on `date`, so this settles in one pass, and an effect
    // would paint a frame of the empty grid before correcting it.
    const settled = settleBookingDay({ date, farDay, workingDays, openDays: movable });
    if (settled.date !== date) {
        setDate(settled.date);
        setSlotMinutes(null);
    }

    const timeIsFree = !scheduled || slotIsFree(slots, slotMinutes);
    // What a reschedule changed, each on its own. Only a new day or time is a
    // move: a longer visit at the same start, or the same time at another
    // branch, is sent as that and not reported as moving to where it already is.
    const timeChanged = rescheduling !== undefined && (date !== movingFrom || slotMinutes !== bookedAt);
    const lengthChanged = rescheduling !== undefined && duration !== rescheduling.durationMinutes;
    const branchChanged = rescheduling !== undefined && branch !== rescheduling.branchId;
    const planChanged = rescheduling !== undefined && planSeeded && !samePlan(plan, rescheduling.procedures);
    const noteEdited = rescheduling !== undefined && noteChanged(rescheduling.note, note);
    const whenAnswered = !scheduled || (slotMinutes !== null && timeIsFree);
    // Every question answered is enough. A move that changed nothing still
    // saves and closes, rather than leaving Save changes dead with no word of
    // why.
    const ready = ref !== null && branch !== null && whenAnswered;

    function reset() {
        walkIn.reset();
        create.reset();
        move.reset();
    }

    function book() {
        if (!ref || !branch || !ready) return;

        if (rescheduling) {
            const at = slotMinutes;
            if (at === null) return;
            // Nothing the server holds has changed, so there is nothing to write.
            if (!timeChanged && !lengthChanged && !branchChanged && !planChanged && !noteEdited) {
                onBooked(t("{name}'s booking is unchanged", { name }));
                return;
            }
            move.mutate(
                {
                    id: rescheduling.id,
                    // Only what the edit changes: a length Settings has since
                    // dropped is refused if it is sent back unchanged.
                    ...(timeChanged ? { startsAt: isoAt(date, at) } : {}),
                    ...(lengthChanged ? { durationMinutes: duration } : {}),
                    ...(branchChanged ? { branchId: branch } : {}),
                    ...(planChanged ? { procedures: bookedProcedures(plan) } : {}),
                    ...(noteEdited ? { note: noteValue(note) } : {}),
                },
                {
                    onSuccess: () =>
                        onBooked(
                            !timeChanged
                                ? t("{name}'s booking updated", { name })
                                : t('{name} moved to {day} at {time}', {
                                      name,
                                      day: dayLabel(date),
                                      time: timeLabel(at),
                                  }),
                        ),
                },
            );
            return;
        }

        const procedures = bookedProcedures(plan);
        const body = noteValue(note);

        if (!scheduled) {
            walkIn.mutate(
                {
                    patient: ref,
                    branchId: branch,
                    durationMinutes: duration,
                    procedures,
                    note: body,
                    needsLab,
                    offsetMinutes: clinicOffsetNow(),
                },
                {
                    // A walk-in is never refused for want of room — the booked
                    // day moves out of its way — so the desk is told when it
                    // did, because those are patients who were given a time.
                    //
                    // It is also told when the walk-in did not get the chair
                    // straight away: one procedure is already under way and is
                    // not interrupted, so this patient waits, and the person
                    // saying "you're checked in" needs to be able to say until
                    // when in the same breath.
                    onSuccess: (result) => {
                        const pushed = result.moved.length;
                        const seated = time12(result.appointment.startsAt);
                        const at = `${seated.time} ${seated.meridiem}`;
                        // A minute of slack: the round trip alone puts the
                        // start a few seconds behind the clock, and that is
                        // still "now" to the person at the desk.
                        const waits = new Date(result.appointment.startsAt).getTime() > serverNow() + 60_000;

                        const parts = [
                            name
                                ? waits
                                    ? t('{name} is checked in, seen at {time}', { name, time: at })
                                    : t('{name} is checked in', { name })
                                : waits
                                  ? t('Walk-in checked in, seen at {time}', { time: at })
                                  : t('Walk-in checked in'),
                            pushed > 0
                                ? t(
                                      pushed === 1
                                          ? '{count} appointment moved back'
                                          : '{count} appointments moved back',
                                      {
                                          count: pushed,
                                      },
                                  )
                                : null,
                        ].filter((part) => part !== null);

                        onBooked(parts.join(' — '));
                    },
                },
            );
            return;
        }

        if (slotMinutes === null) return;

        create.mutate(
            {
                patient: ref,
                branchId: branch,
                startsAt: isoAt(date, slotMinutes),
                durationMinutes: duration,
                procedures,
                note: body,
                needsLab,
                offsetMinutes: offsetForDate(date),
            },
            {
                onSuccess: () =>
                    onBooked(
                        t('{name} — {day} at {time}', {
                            name,
                            day: dayLabel(date),
                            time: timeLabel(slotMinutes),
                        }),
                    ),
            },
        );
    }

    // How long is asked before what time, because the grid tiles the day by it.
    // A walk-in has no grid, so it gets the same control on its own.
    const howLong = (
        <View style={styles.section}>
            <Text variant="eyebrow" tone="muted">
                {t('HOW LONG')}
            </Text>
            {/* Four to a row, wrapping — not one row of `grow` chips. Settings
                lets the clinic keep up to twelve lengths and this screen has to
                draw whatever it finds: `grow` is `flex: 1`, which overrides the
                wrap and squeezes every option onto one line, so at eight of them
                "45 min" came out as three stacked characters. The width is the
                cell's; the chip grows to fill it. */}
            <View style={styles.durations}>
                {lengths.map((option) => (
                    <View key={option} style={styles.duration}>
                        <Chip
                            label={t('{minutes} min', { minutes: option })}
                            grow
                            selected={duration === option}
                            onPress={() => {
                                setDuration(option);
                                // A new length is a new set of start times, and
                                // the old pick is usually not one of them.
                                setSlotMinutes(null);
                                reset();
                            }}
                        />
                    </View>
                ))}
            </View>
        </View>
    );

    const last = step === 'confirm';
    const stepReady = step === 'when' ? whenAnswered && branch !== null : true;
    const barIdle = last ? !ready : !stepReady;

    return (
        <View style={styles.screen} testID="booking-screen">
            <View style={styles.topbar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(index === 0 ? 'Back to the day' : 'Back a step')}
                    disabled={pending}
                    onPress={() => {
                        if (index === 0) {
                            onBack();
                            return;
                        }
                        reset();
                        if (scheduled) fortnight.refetch();
                        setIndex(index - 1);
                    }}
                    style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
                >
                    <Chevron direction="back" size={10} tone="ink" />
                </Pressable>
                <Text variant="eyebrow" tone="muted">
                    {t(rescheduling ? 'RESCHEDULE' : 'NEW BOOKING')}
                </Text>
            </View>

            <View style={styles.identity}>
                <View style={styles.tile}>
                    {scheduled ? (
                        <>
                            <Text variant="title2" script="sans" weight="bold" tone="inverse">
                                {dayOfMonth(date)}
                            </Text>
                            <Text variant="eyebrow" tone="inverse" style={styles.tileMonth}>
                                {monthShort(date).toUpperCase()}
                            </Text>
                        </>
                    ) : (
                        <Text variant="eyebrow" tone="inverse">
                            {t('NOW')}
                        </Text>
                    )}
                </View>

                <View style={styles.who}>
                    <Text variant="title2" weight="bold" numberOfLines={1}>
                        {name}
                    </Text>
                    <Text variant="footnote" tone="muted" numberOfLines={1}>
                        {patientPhoneOf(patient) || t('No phone on file')}
                    </Text>
                    <View style={styles.chip}>
                        <Text variant="footnote" weight="bold" tone="ink2">
                            {scheduled
                                ? slotMinutes === null
                                    ? wasLabel
                                        ? t('Booked {when}', { when: wasLabel })
                                        : t('{day} · no time yet', { day: dayLabel(date) })
                                    : `${dayLabel(date)} · ${timeLabel(slotMinutes)}`
                                : t('Walk-in · starting now')}
                        </Text>
                    </View>
                </View>
            </View>

            <Steps index={index} steps={STEPS} testID="booking-steps" />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.body, { paddingBottom: dockHeight + space[5] }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                {/* Keyed on the step, not the answers: every answer lives up here,
                    so the slide only moves what is drawn. */}
                <StepView index={index} style={styles.stepBody}>
                    {step === 'what' ? (
                        <>
                            <ProcedurePlan
                                value={plan}
                                onChange={setPlan}
                                categories={catalogue.data ?? []}
                                loading={catalogue.status === 'loading'}
                                error={catalogue.status === 'error' ? catalogue.error : null}
                                onRetry={catalogue.refetch}
                                general={general}
                            />

                            {rescheduling ? null : (
                                <View style={styles.labCard}>
                                    <LabSwitch
                                        value={needsLab}
                                        onValueChange={setNeedsLab}
                                        testID="booking-needs-lab"
                                    />
                                </View>
                            )}

                            <Textarea
                                label="Note"
                                value={note}
                                onChangeText={setNote}
                                placeholder="Anything the doctor should know."
                            />
                        </>
                    ) : step === 'when' ? (
                        <>
                            <View style={styles.section}>
                                <Text variant="eyebrow" tone="muted">
                                    {t('WHEN')}
                                </Text>

                                {branches.length > 1 ? (
                                    <Select
                                        label="Branch"
                                        options={branches.map((row) => ({
                                            value: row.id,
                                            label: row.name,
                                        }))}
                                        value={branch}
                                        onChange={(next) => {
                                            setBranch(next);
                                            setSlotMinutes(null);
                                            // Branches keep different working days, so
                                            // the day in hand may not be one of the new
                                            // one's. Landing on its next working day
                                            // beats a strip with nothing in it.
                                            setDate(nextWorkingDay(date, schedule, next));
                                            reset();
                                        }}
                                        sheetTitle="Which branch"
                                    />
                                ) : null}

                                {rescheduling ? null : (
                                    <>
                                        <View style={styles.row}>
                                            <Chip
                                                label="Now — walk-in"
                                                grow
                                                selected={!scheduled}
                                                disabled={!canWalkIn}
                                                onPress={() => {
                                                    setTiming('now');
                                                    reset();
                                                }}
                                            />
                                            <Chip
                                                label="Another time"
                                                grow
                                                selected={scheduled}
                                                onPress={() => {
                                                    setTiming('later');
                                                    reset();
                                                }}
                                            />
                                        </View>

                                        {!canWalkIn ? (
                                            <Text variant="caption" tone="muted">
                                                {branchName
                                                    ? t(
                                                          '{branch} is not working today, so there is no walk-in to take.',
                                                          {
                                                              branch: branchName,
                                                          },
                                                      )
                                                    : t(
                                                          'The clinic is not working today, so there is no walk-in to take.',
                                                      )}
                                            </Text>
                                        ) : !scheduled && dateKey !== today ? (
                                            <Text variant="caption" tone="muted">
                                                {t(
                                                    'A walk-in starts now, so it lands on today — not the day on screen.',
                                                )}
                                            </Text>
                                        ) : !scheduled ? (
                                            <Text variant="subhead" tone="muted">
                                                {t(
                                                    'Booked and checked in at once, the same as anyone already in the waiting room.',
                                                )}
                                            </Text>
                                        ) : null}
                                    </>
                                )}
                            </View>

                            {scheduled ? (
                                <SlotPicker
                                    dateKey={date}
                                    days={settled.strip}
                                    daysLoading={fetched === undefined && fortnight.status !== 'error'}
                                    onPickDate={setDate}
                                    onPickFurtherDate={() => setCalendar(openCalendar)}
                                    slotMinutes={slotMinutes}
                                    onPickSlot={(next) => {
                                        setSlotMinutes(next);
                                        reset();
                                    }}
                                    slots={slots}
                                    loading={fetched === undefined && fortnight.status !== 'error'}
                                    error={fortnight.status === 'error' ? fortnight.error : null}
                                    onRetry={fortnight.refetch}
                                    branchName={branchName}
                                    duration={howLong}
                                />
                            ) : (
                                howLong
                            )}
                        </>
                    ) : (
                        <>
                            <View style={styles.card}>
                                <SummaryRow
                                    label="When"
                                    value={
                                        scheduled && slotMinutes !== null
                                            ? `${relativeDayLabel(date)} · ${timeLabel(slotMinutes)}`
                                            : t('Now — walk-in')
                                    }
                                    icon={<CalendarIcon size={17} />}
                                    lead
                                />
                                {rescheduling && movingFrom ? (
                                    <SummaryRow
                                        label="Was"
                                        value={`${relativeDayLabel(movingFrom)} · ${timeLabel(minutesOfDay(rescheduling.startsAt))}`}
                                        icon={<CalendarIcon size={15} />}
                                    />
                                ) : null}
                                <SummaryRow
                                    label="How long"
                                    value={t('{minutes} min', { minutes: duration })}
                                    icon={<DurationIcon />}
                                />
                                {branches.length > 1 ? (
                                    <SummaryRow
                                        label="Branch"
                                        value={branches.find((row) => row.id === branch)?.name ?? '—'}
                                        icon={<PinIcon />}
                                    />
                                ) : null}
                                <SummaryRow
                                    label="Patient"
                                    value={patient.mode === 'new' ? t('{name} · new record', { name }) : name}
                                    icon={<PatientIcon />}
                                />
                                {needsLab ? (
                                    <SummaryRow label="Lab work" value={t('Needed')} icon={<LabIcon />} />
                                ) : null}
                            </View>

                            <View style={styles.section}>
                                <View style={styles.head}>
                                    <Text variant="eyebrow" tone="muted">
                                        {t('WHAT IS PLANNED')}
                                    </Text>
                                    <Text variant="caption" weight="medium" tone="muted">
                                        {plan.length === 0
                                            ? t('Nothing yet')
                                            : t(
                                                  plan.length === 1
                                                      ? '{count} procedure'
                                                      : '{count} procedures',
                                                  {
                                                      count: plan.length,
                                                  },
                                              )}
                                    </Text>
                                </View>

                                {plan.length === 0 ? (
                                    <View style={styles.emptyPlan}>
                                        <Text variant="subhead" tone="muted">
                                            {t('No procedures planned — it will be decided in the chair.')}
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.groups}>
                                        {groupByTooth(plan).map((group) => (
                                            <ToothGroupCard
                                                key={group.tooth ?? 'none'}
                                                tooth={group.tooth}
                                                position={toothPosition(group.tooth, general)}
                                                subtotal={
                                                    <MoneyValue
                                                        piastres={group.subtotal}
                                                        variant="headline"
                                                        weight="bold"
                                                    />
                                                }
                                                lines={group.items.map((item) => ({
                                                    id: item.id,
                                                    name: item.name,
                                                    detail: item.variant,
                                                    money: (
                                                        <MoneyValue
                                                            piastres={item.price}
                                                            variant="body"
                                                            weight="bold"
                                                        />
                                                    ),
                                                }))}
                                            />
                                        ))}

                                        <View style={styles.total}>
                                            <Text variant="subhead" tone="muted">
                                                {t('Estimated total')}
                                            </Text>
                                            <Text variant="title3" weight="bold">
                                                {formatMoney(totalOf(plan))}
                                            </Text>
                                        </View>
                                    </View>
                                )}
                            </View>

                            {note.trim() ? (
                                <View style={styles.section}>
                                    <Text variant="eyebrow" tone="muted">
                                        {t('NOTE')}
                                    </Text>
                                    <View style={styles.noteCard}>
                                        <Text variant="callout" tone="ink2">
                                            {note.trim()}
                                        </Text>
                                    </View>
                                </View>
                            ) : null}
                        </>
                    )}
                </StepView>
            </ScrollView>

            {/* Over the scroll rather than beside it. As a sibling in the column
                the bar took a strip of its own and the grid stopped dead at it,
                clipping the last row of times mid-chip — which no amount of
                transparency fixes, because the content never reached under it.
                `box-none` so the empty width of the dock does not eat taps meant
                for the times behind it. */}
            {/* The keyboard goes in the dock's own floor. The dock is pinned to
                the bottom of a window that `edgeToEdgeEnabled` stops resizing
                (see `ui/useKeyboardHeight`), so with the keys up it stayed put
                and they were drawn over the Note field and the step's button.
                Its bottom edge is fixed and its height is auto, so padding the
                floor grows it upwards and carries both clear — and because
                `dockHeight` is measured off this same view, the scroll's bottom
                padding follows without being told. */}
            <View
                style={[styles.dock, { paddingBottom: keyboard }]}
                pointerEvents="box-none"
                onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
            >
                {branch === null ? (
                    <View style={styles.notice}>
                        <Callout tone="warning" title="No branch to book into">
                            {t(
                                'The clinic’s branches could not be loaded, so there is nowhere to put this booking.',
                            )}
                        </Callout>
                    </View>
                ) : null}

                {failure ? (
                    <View style={styles.notice}>
                        <Callout tone="warning" title={failure.title}>
                            {failure.body ?? ''}
                        </Callout>
                    </View>
                ) : null}

                <View style={styles.bar}>
                    <Button
                        label={
                            last
                                ? rescheduling
                                    ? timeChanged
                                        ? 'Move it'
                                        : 'Save changes'
                                    : scheduled
                                      ? 'Book it'
                                      : 'Start the visit'
                                : 'Next'
                        }
                        block
                        loading={pending}
                        // Grey until the step's questions are answered, so a
                        // press that does nothing never looks like a frozen app.
                        disabled={barIdle}
                        onPress={() => {
                            if (last) {
                                book();
                                return;
                            }
                            reset();
                            setIndex(index + 1);
                        }}
                        testID="booking-next"
                    />
                </View>
            </View>

            {/* The day view's own calendar, in `book` mode: it counts every
                branch the same way, but the branch here is a field of this form
                and the pick must not move it. Keyed by `seq` for the reason the
                day screens key it — its month is `useState` off the day handed
                in, so a sheet that survived would reopen on the month it was
                last left on. */}
            <CalendarSheet
                key={`booking-calendar:${calendar.seq}`}
                visible={calendar.open}
                selected={date}
                schedule={schedule}
                branches={branches}
                branchId={branch}
                mode="book"
                onPick={(picked) => {
                    setFarDay(picked);
                    setDate(picked);
                    setSlotMinutes(null);
                    reset();
                }}
                onClose={() => setCalendar(closeCalendar)}
            />
        </View>
    );
}

/**
 * The first day from `from` the branch actually works, within the fortnight the
 * strip offers. A branch with no working day at all keeps the day it was on —
 * there is nowhere better to go, and the picker says so in words.
 */
function nextWorkingDay(
    from: string,
    schedule: readonly ClinicDay[] | undefined,
    branchId: string | null,
): string {
    for (let ahead = 0; ahead < 14; ahead += 1) {
        const key = addDays(from, ahead);
        if (!isClosed(key, schedule, branchId)) return key;
    }
    return from;
}

/** "today"/"tomorrow" read as words in a sentence; a date keeps its capitals. */
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },

    topbar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingHorizontal: space[3],
        paddingTop: space[2],
        paddingBottom: space[1],
    },
    back: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    backPressed: { backgroundColor: color.surface2 },

    identity: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3.5],
        paddingHorizontal: size.gutter,
        paddingTop: space[2],
        paddingBottom: space[4],
    },
    tile: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.xl2,
        backgroundColor: color.ink,
    },
    tileMonth: { opacity: 0.62 },
    who: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
    chip: {
        paddingHorizontal: space[2.5],
        paddingVertical: space[1],
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },

    scroll: { flex: 1 },
    // No `paddingBottom` here — it is measured off the dock and supplied inline,
    // so the grid's bottom row can always be scrolled clear of the floating bar.
    body: { paddingHorizontal: size.gutter },
    stepBody: { gap: space[5] },
    section: { gap: space[2.5] },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    grow: { flex: 1, minWidth: 0 },
    durations: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    /** Four to a row — 4×23% leaves the three gaps their 8pt and a little slack. */
    duration: { width: '23%' },

    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },

    card: {
        gap: space[3],
        padding: space[4],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },

    emptyPlan: {
        padding: space[4],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    groups: { gap: space[3] },
    total: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: space[3.5],
        borderRadius: radius.lg,
        backgroundColor: color.surface2,
    },
    labCard: {
        paddingHorizontal: space[3.5],
        paddingVertical: space[3],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    noteCard: {
        padding: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    // No fill and no rule: the bar is the page showing through, and the button
    // is the only thing on it that is meant to be seen.
    bar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        paddingBottom: space[4],
        backgroundColor: color.transparent,
    },
});
