import type { AppointmentStatus } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: the collapse drives an `Animated.timing` imperatively — the tween chases `open` and has to be stopped on cleanup or it outlives the section
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { StatusBadge, statusCopy, statusLabel } from '../../../components/domain';
import {
    Button,
    Chevron,
    easing,
    duration as motionDuration,
    useReducedMotion,
} from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { rowSummary } from '../agenda';
import type { Appointment } from '../data';
import { type DayDelay, isProjected, ON_TIME, projectedStart } from '../delay';
import { clock12, minutesOfDay, time12 } from '../time';
import {
    ArrowBackIcon,
    ArrowForwardIcon,
    ChairIcon,
    CheckIcon,
    DurationIcon,
    PaymentIcon,
    ProcedureIcon,
    WaitingIcon,
} from './icons';
import { LabTag } from './LabWork';

export type AgendaRowProps = {
    appointment: Appointment;
    onPress: () => void;
    procedure?: string;
    dim?: boolean;
    inChair?: boolean;
    trailing?: React.ReactNode;
    onNoShow?: () => void;
    projectedMinutes?: number | null;
};

const SWIPE_THRESHOLD = 96;

export function AgendaRow({
    appointment,
    onPress,
    procedure,
    dim = false,
    inChair = false,
    trailing,
    onNoShow,
    projectedMinutes = null,
}: AgendaRowProps) {
    const t = useT();
    const slide = useRef(new Animated.Value(0)).current;
    const [armed, setArmed] = useState(false);

    const pan = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_event, gesture) =>
                onNoShow !== undefined &&
                Math.abs(gesture.dx) > 12 &&
                Math.abs(gesture.dx) > Math.abs(gesture.dy),
            onPanResponderMove: (_event, gesture) => {
                slide.setValue(gesture.dx);
                setArmed(Math.abs(gesture.dx) >= SWIPE_THRESHOLD);
            },
            onPanResponderRelease: (_event, gesture) => {
                const commit = Math.abs(gesture.dx) >= SWIPE_THRESHOLD;
                setArmed(false);
                Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
                if (commit) onNoShow?.();
            },
            onPanResponderTerminate: () => {
                setArmed(false);
                Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
            },
        }),
    ).current;

    const body = { appointment, onPress, procedure, dim, inChair, trailing, projectedMinutes };

    if (!onNoShow) return <RowBody {...body} />;

    return (
        <View style={styles.swipe} {...pan.panHandlers}>
            <View style={styles.behind} pointerEvents="none">
                <Text variant="footnote" weight="semibold" tone={armed ? 'due' : 'muted'}>
                    {t('No-show')}
                </Text>
                <Text variant="footnote" weight="semibold" tone={armed ? 'due' : 'muted'}>
                    {t('No-show')}
                </Text>
            </View>
            <Animated.View style={[styles.front, { transform: [{ translateX: slide }] }]}>
                <RowBody {...body} />
            </Animated.View>
        </View>
    );
}

const CHAIR_TINT = color.accentSoft;

const TINT: Partial<Record<AppointmentStatus, string>> = {
    checked_in: color.dueSoft,
    awaiting_payment: color.accentSoft,
};

function RowBody({
    appointment,
    onPress,
    procedure,
    dim = false,
    inChair = false,
    trailing,
    projectedMinutes = null,
}: AgendaRowProps) {
    const t = useT();
    const { time, meridiem } = time12(appointment.startsAt);
    const slipped = projectedMinutes !== null && projectedMinutes > minutesOfDay(appointment.startsAt);
    const shown = slipped ? clock12(projectedMinutes) : { time, meridiem };
    const tint = dim ? undefined : inChair ? CHAIR_TINT : TINT[appointment.status];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[
                `${time} ${meridiem}`,
                appointment.patient.name,
                statusLabel(appointment.status, inChair),
                ...(appointment.labStatus === 'pending' ? [t('Lab not back yet')] : []),
            ].join(', ')}
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                dim && styles.dim,
                tint && [styles.tinted, { backgroundColor: tint }],
                pressed && styles.pressed,
            ]}
        >
            <View style={styles.clock}>
                <Text
                    variant="headline"
                    script="mono"
                    weight="semibold"
                    tone={slipped ? 'due' : dim ? 'muted' : 'ink'}
                    numberOfLines={1}
                >
                    {shown.time}
                </Text>
                <Text variant="tag" tone={slipped ? 'due' : 'muted'}>
                    {shown.meridiem}
                </Text>
            </View>

            <View style={styles.body}>
                <View style={styles.nameLine}>
                    <Text
                        variant="headline"
                        weight="semibold"
                        tone={dim ? 'ink2' : 'ink'}
                        numberOfLines={1}
                        style={styles.name}
                    >
                        {appointment.patient.name}
                    </Text>
                    <LabTag status={appointment.labStatus} />
                </View>

                <View style={styles.meta}>
                    {procedure ? <ProcedureIcon size={13} /> : <DurationIcon size={13} />}
                    <Text variant="subhead" tone="muted" numberOfLines={1} style={styles.name}>
                        {procedure
                            ? t('{procedure} · {minutes} min', {
                                  procedure,
                                  minutes: appointment.durationMinutes,
                              })
                            : t('{minutes} min', { minutes: appointment.durationMinutes })}
                    </Text>
                </View>
            </View>

            {trailing}
        </Pressable>
    );
}

type CheckInControlProps = {
    appointment: Appointment;
    loading: boolean;
    inChair: boolean;
    onCheckIn: (appointment: Appointment) => void;
};

function CheckInControl({ appointment, loading, inChair, onCheckIn }: CheckInControlProps) {
    const t = useT();
    if (appointment.status === 'booked') {
        return (
            <Button
                label="Check in"
                variant="secondary"
                size="md"
                loading={loading}
                icon={<CheckIcon size={13} stroke={color.ink} />}
                style={styles.pill}
                onPress={() => onCheckIn(appointment)}
            />
        );
    }

    const label = t(statusCopy(appointment.status, inChair));
    const seated = inChair || appointment.status === 'awaiting_payment';
    const tone = seated ? color.accent : color.due;
    const Icon = inChair ? ChairIcon : appointment.status === 'awaiting_payment' ? PaymentIcon : WaitingIcon;

    return (
        <View style={styles.chip} pointerEvents="none">
            <Icon size={13} stroke={tone} />
            <Text variant="callout" weight="semibold" tone={seated ? 'accent' : 'due'}>
                {label}
            </Text>
        </View>
    );
}

export type UpNextProps = {
    appointments: readonly Appointment[];
    chairId: string | null;
    delay?: DayDelay;
    nowMinutes?: number | null;
    relativeToNow: boolean;
    checkingInId: string | null;
    onSelect: (appointment: Appointment) => void;
    onCheckIn: (appointment: Appointment) => void;
    onNoShow: (appointment: Appointment) => void;
};

export function UpNext({
    appointments,
    chairId,
    delay = ON_TIME,
    nowMinutes = null,
    relativeToNow,
    checkingInId,
    onSelect,
    onCheckIn,
    onNoShow,
}: UpNextProps) {
    const t = useT();
    if (appointments.length === 0) return null;

    const live = relativeToNow;

    return (
        <View style={[styles.section, styles.upNext]}>
            <View style={styles.sectionLabel}>
                <ArrowForwardIcon size={13} />
                <Text variant="eyebrow" tone="muted">
                    {`${t(relativeToNow ? 'AFTER THIS' : 'THE DAY')} · ${appointments.length}`}
                </Text>
            </View>

            {appointments.map((appointment) => (
                <AgendaRow
                    key={appointment.id}
                    appointment={appointment}
                    procedure={rowSummary(appointment)}
                    onPress={() => onSelect(appointment)}
                    dim={!live}
                    inChair={live && appointment.id === chairId}
                    projectedMinutes={
                        isProjected(appointment, delay)
                            ? projectedStart(appointment, delay, nowMinutes)
                            : null
                    }
                    onNoShow={
                        live && appointment.status === 'booked' ? () => onNoShow(appointment) : undefined
                    }
                    trailing={
                        live ? (
                            <CheckInControl
                                appointment={appointment}
                                loading={checkingInId === appointment.id}
                                inChair={appointment.id === chairId}
                                onCheckIn={onCheckIn}
                            />
                        ) : (
                            <StatusBadge status={appointment.status} inChair={appointment.id === chairId} />
                        )
                    }
                />
            ))}
        </View>
    );
}

export type BeforeThisProps = {
    appointments: readonly Appointment[];
    onSelect: (appointment: Appointment) => void;
};

export function BeforeThis({ appointments, onSelect }: BeforeThisProps) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [contentHeight, setContentHeight] = useState(0);
    const reducedMotion = useReducedMotion();
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const to = open ? 1 : 0;
        if (reducedMotion) {
            progress.setValue(to);
            return;
        }
        const tween = Animated.timing(progress, {
            toValue: to,
            duration: motionDuration.fadeup,
            easing: easing.promote,
            useNativeDriver: false,
        });
        tween.start();
        return () => tween.stop();
    }, [open, reducedMotion, progress]);

    if (appointments.length === 0) return null;

    const height = progress.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] });
    const opacity = progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.85, 1] });
    const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-space[2], 0] });
    const spin = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

    return (
        <View style={styles.section}>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={t('Before this, {count} appointments', { count: appointments.length })}
                onPress={() => setOpen((current) => !current)}
                style={({ pressed }) => [styles.sectionLabel, pressed && styles.pressed]}
            >
                <ArrowBackIcon size={13} />
                <Text variant="eyebrow" tone="muted">
                    {t('BEFORE THIS · {count}', { count: appointments.length })}
                </Text>
                <View style={styles.spacer} />
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                    <Chevron direction="down" size={7} />
                </Animated.View>
            </Pressable>

            <Animated.View
                style={[styles.collapse, { height, opacity }]}
                pointerEvents={open ? 'auto' : 'none'}
                accessibilityElementsHidden={!open}
                importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
            >
                <Animated.View
                    onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
                    style={[styles.collapseBody, { transform: [{ translateY }] }]}
                >
                    {appointments.map((appointment) => (
                        <AgendaRow
                            key={appointment.id}
                            appointment={appointment}
                            procedure={rowSummary(appointment)}
                            onPress={() => onSelect(appointment)}
                            dim
                            trailing={<StatusBadge status={appointment.status} />}
                        />
                    ))}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { paddingHorizontal: size.gutter },
    collapse: { overflow: 'hidden' },
    collapseBody: { position: 'absolute', start: 0, end: 0, top: 0 },
    upNext: { marginTop: space[2] },
    sectionLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1.5],
        minHeight: space[6],
    },
    spacer: { flex: 1 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3.5],
        paddingVertical: space[3],
        minHeight: size.row,
        borderBottomWidth: border.hair,
        borderBottomColor: color.line,
    },
    dim: { opacity: 0.72 },
    tinted: {
        paddingHorizontal: space[3],
        marginHorizontal: -space[2],
        borderRadius: radius.lg,
        borderBottomColor: 'transparent',
    },
    swipe: { position: 'relative' },
    behind: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        start: 0,
        end: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space[4],
    },
    front: { backgroundColor: color.canvas },
    pressed: { backgroundColor: color.surface2 },
    clock: {
        width: 74,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: space[0.5],
    },
    body: { flex: 1, gap: space[0.5] },
    name: { flexShrink: 1 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    pill: { borderRadius: radius.full, paddingHorizontal: space[3], minWidth: 118 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[2],
        minWidth: 118,
        minHeight: size.row,
        paddingHorizontal: space[3],
    },
});
