import { Pressable, StyleSheet, View } from 'react-native';
import { StatusPill, TimeValue } from '../../../components/domain';
import { Chevron } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import type { Appointment } from '../data';
import { formatClock12, minutesOfDay } from '../time';
import { LabTag } from './LabWork';

export type AppointmentRowProps = {
    appointment: Appointment;
    onPress: () => void;
    projectedMinutes?: number | null;
    inChair?: boolean;
};

export function AppointmentRow({
    appointment,
    onPress,
    projectedMinutes = null,
    inChair = false,
}: AppointmentRowProps) {
    const t = useT();
    const past = appointment.status === 'done' || appointment.status === 'cancelled';
    const booked = minutesOfDay(appointment.startsAt);
    const slipped = projectedMinutes !== null && projectedMinutes > booked;
    const shownMinutes = slipped ? projectedMinutes : booked;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[
                formatClock12(booked),
                appointment.patient.name,
                ...(appointment.labStatus === 'pending' ? [t('Lab not back yet')] : []),
            ].join(', ')}
            onPress={onPress}
            style={({ pressed }) => [styles.row, past && styles.past, pressed && styles.pressed]}
        >
            <View style={styles.time}>
                <TimeValue minutes={shownMinutes} weight="medium" tone={slipped ? 'due' : 'ink'} />
            </View>

            <View style={styles.body}>
                <Text variant="headline" weight="semibold" numberOfLines={1}>
                    {appointment.patient.name}
                </Text>
                <View style={styles.meta}>
                    <Text variant="subhead" tone="muted">
                        {t('{minutes} min', { minutes: appointment.durationMinutes })}
                    </Text>
                    <StatusPill status={appointment.status} inChair={inChair} />
                    <LabTag status={appointment.labStatus} />
                </View>
            </View>

            <Chevron />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row,
        padding: space[3],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
    },
    past: { opacity: 0.72 },
    pressed: { backgroundColor: color.surface2 },
    time: { width: 80, flexShrink: 0 },
    body: { flex: 1, gap: space[1] },
    meta: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
});
