import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { serverNow } from '../../../api';
import { MoneyValue, ToothGroupCard } from '../../../components/domain';
import {
    Button,
    Callout,
    Chevron,
    Chip,
    ConfirmSheet,
    Select,
    StepView,
    Textarea,
    useKeyboardHeight,
} from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { bookingActions } from '../actions';
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
    patient: PatientDraft;
    timing?: Timing;
    rescheduling?: Appointment;
    branchId: string | null;
    branches: readonly Branch[];
    schedule: readonly ClinicDay[] | undefined;
    durationOptions: readonly number[];
    defaultDuration: number;
    dateKey: string;
    nowMinutes: number;
    onBack: () => void;
    onBooked: (message: string) => void;
    onCancelled?: (message: string) => void;
};

const STRIP_DAYS = 14;

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
    onCancelled,
}: BookingScreenProps) {
    const t = useT();
    const today = todayKey();

    const [index, setIndex] = useState(0);
    const [plan, setPlan] = useState<PlannedProcedure[]>([]);
    const [planSeeded, setPlanSeeded] = useState(rescheduling === undefined);
    const movingFrom = rescheduling ? dayKeyOf(rescheduling.startsAt) : null;
    const openOn = movingFrom ?? dateKey;
    const [timing, setTiming] = useState<Timing>(
        asked ?? (!isClosed(today, schedule, branchId) && dateKey === today ? 'now' : 'later'),
    );
    const [date, setDate] = useState(openOn < today ? today : openOn);
    const [farDay, setFarDay] = useState<string | null>(
        openOn > addDays(today, STRIP_DAYS - 1) ? openOn : null,
    );
    const [calendar, setCalendar] = useState<CalendarState>(CALENDAR_CLOSED);
    const [slotMinutes, setSlotMinutes] = useState<number | null>(
        rescheduling ? minutesOfDay(rescheduling.startsAt) : null,
    );
    const [duration, setDuration] = useState(defaultDuration);
    const [note, setNote] = useState(() => noteDraft(rescheduling?.note));
    const [needsLab, setNeedsLab] = useState(false);
    const [branch, setBranch] = useState<string | null>(branchId);
    const [dockHeight, setDockHeight] = useState(BAR_HEIGHT);
    const keyboard = useKeyboardHeight();

    const canWalkIn = !isClosed(today, schedule, branch);
    const branchName = branches.find((row) => row.id === branch)?.name ?? null;

    const walkIn = useLocalMutation(api.walkIn);
    const create = useLocalMutation(api.create);
    const move = useLocalMutation(api.reschedule);
    const cancel = useLocalMutation(api.cancel);
    const [confirmingCancel, setConfirmingCancel] = useState(false);
    const canCancel =
        rescheduling !== undefined && onCancelled !== undefined && bookingActions(rescheduling, today).cancel;

    const step = STEPS[index]?.key ?? 'confirm';
    const scheduled = rescheduling !== undefined || timing === 'later' || !canWalkIn;
    const pending = walkIn.pending || create.pending || move.pending || cancel.pending;
    const error = rescheduling ? move.error : scheduled ? create.error : walkIn.error;
    const failure = error
        ? describeError(error, rescheduling ? 'move' : scheduled ? 'booking' : 'walk-in')
        : null;

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

    if (!planSeeded && rescheduling && catalogue.data) {
        setPlanSeeded(true);
        setPlan(planFrom(rescheduling.procedures, catalogue.data));
    }

    const owedTo =
        rescheduling === undefined && patient.mode === 'existing' ? (patient.picked?.id ?? null) : null;
    const owed = useLocalQuery(`next-procedures:${owedTo}`, () => api.pendingNextProcedures(owedTo ?? ''), {
        enabled: owedTo !== null,
    });
    const [owedSeeded, setOwedSeeded] = useState(owedTo === null);
    if (!owedSeeded && owed.data !== undefined && catalogue.data) {
        setOwedSeeded(true);
        if (owed.data.length > 0 && plan.length === 0) {
            setPlan(
                planFrom(
                    owed.data.map((line, i) => ({
                        ...line,
                        id: `next-${i}-${line.procedureId}`,
                        quantity: 1,
                        note: null,
                        quotedPrice: null,
                    })),
                    catalogue.data,
                ),
            );
        }
    }

    const workingDays = useMemo(
        () => daysOffered(today, STRIP_DAYS, farDay, schedule, branch),
        [today, farDay, schedule, branch],
    );

    const fortnight = useLocalQuery(
        `booking-days:${branch}:${workingDays.join(',')}`,
        () => api.byDates(workingDays),
        { enabled: scheduled && workingDays.length > 0 },
    );

    const fetched = useMemo(
        () => withoutAppointment(fortnight.data, rescheduling?.id),
        [fortnight.data, rescheduling?.id],
    );

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

    const settled = settleBookingDay({ date, farDay, workingDays, openDays: movable });
    if (settled.date !== date) {
        setDate(settled.date);
        setSlotMinutes(null);
    }

    const timeIsFree = !scheduled || slotIsFree(slots, slotMinutes);
    const timeChanged = rescheduling !== undefined && (date !== movingFrom || slotMinutes !== bookedAt);
    const lengthChanged = rescheduling !== undefined && duration !== rescheduling.durationMinutes;
    const branchChanged = rescheduling !== undefined && branch !== rescheduling.branchId;
    const planChanged = rescheduling !== undefined && planSeeded && !samePlan(plan, rescheduling.procedures);
    const noteEdited = rescheduling !== undefined && noteChanged(rescheduling.note, note);
    const whenAnswered = !scheduled || (slotMinutes !== null && timeIsFree);
    const ready = ref !== null && branch !== null && whenAnswered;

    function reset() {
        walkIn.reset();
        create.reset();
        move.reset();
    }

    function cancelBooking() {
        if (!rescheduling || !onCancelled) return;
        cancel.mutate(rescheduling.id, {
            onSuccess: () => {
                setConfirmingCancel(false);
                onCancelled(t("{name}'s booking was cancelled", { name }));
            },
        });
    }

    function book() {
        if (!ref || !branch || !ready) return;

        if (rescheduling) {
            const at = slotMinutes;
            if (at === null) return;
            if (!timeChanged && !lengthChanged && !branchChanged && !planChanged && !noteEdited) {
                onBooked(t("{name}'s booking is unchanged", { name }));
                return;
            }
            move.mutate(
                {
                    id: rescheduling.id,
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
                    onSuccess: (result) => {
                        const pushed = result.moved.length;
                        const seated = time12(result.appointment.startsAt);
                        const at = `${seated.time} ${seated.meridiem}`;
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

    const howLong = (
        <View style={styles.section}>
            <Text variant="eyebrow" tone="muted">
                {t('HOW LONG')}
            </Text>
            <View style={styles.durations}>
                {lengths.map((option) => (
                    <View key={option} style={styles.duration}>
                        <Chip
                            label={t('{minutes} min', { minutes: option })}
                            grow
                            selected={duration === option}
                            onPress={() => {
                                setDuration(option);
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
                <Text variant="eyebrow" tone="muted" style={styles.topbarTitle}>
                    {t(rescheduling ? 'RESCHEDULE' : 'NEW BOOKING')}
                </Text>
                {canCancel ? (
                    <Button
                        label="Cancel booking"
                        variant="dangerText"
                        size="md"
                        disabled={pending}
                        onPress={() => {
                            cancel.reset();
                            setConfirmingCancel(true);
                        }}
                        testID="booking-cancel"
                    />
                ) : null}
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

            <ConfirmSheet
                visible={confirmingCancel}
                title="Cancel this appointment?"
                body="The slot goes back on the day and the patient keeps their record. Nothing is deleted."
                detail={
                    cancel.error ? (
                        <Callout tone="warning" title={describeError(cancel.error).title}>
                            {describeError(cancel.error).body ?? ''}
                        </Callout>
                    ) : null
                }
                confirmLabel="Cancel it"
                cancelLabel="Keep it"
                destructive
                loading={cancel.pending}
                onConfirm={cancelBooking}
                onCancel={() => setConfirmingCancel(false)}
                testID="booking-cancel-confirm"
            />
        </View>
    );
}

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
    topbarTitle: { flex: 1 },
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
    body: { paddingHorizontal: size.gutter },
    stepBody: { gap: space[5] },
    section: { gap: space[2.5] },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    grow: { flex: 1, minWidth: 0 },
    durations: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
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
    bar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        paddingBottom: space[4],
        backgroundColor: color.transparent,
    },
});
