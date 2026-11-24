import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, size, space, Text } from '../../../theme';
import { api, useLocalQuery } from '../data';
import { describeError } from '../errors';
import { draftFor } from '../patientDraft';
import { todayKey } from '../time';
import { useNowMinutes } from '../useNow';
import { BookingScreen } from './BookingScreen';

export type ReschedulePageProps = {
    appointmentId: string;
    onClose: () => void;
    onChanged?: () => void;
};

export function ReschedulePage({ appointmentId, onClose, onChanged }: ReschedulePageProps) {
    const t = useT();
    const nowMinutes = useNowMinutes();
    const appointment = useLocalQuery(`appointment:${appointmentId}`, () =>
        api.appointmentById(appointmentId),
    );
    const schedule = useLocalQuery('schedule', api.schedule);
    const branches = useLocalQuery('branches', api.branches);
    const settings = useLocalQuery('settings', api.settings);

    const closing = useRef(false);

    function close(changed = false) {
        if (closing.current) return;
        closing.current = true;
        if (changed) onChanged?.();
        onClose();
    }

    const failure = appointment.error ?? branches.error;

    if (failure) {
        return (
            <View style={styles.state}>
                <Banner tone="warning" message={describeError(failure, 'move').title} />
                <View style={styles.actions}>
                    <Button label="Try again" variant="text" onPress={appointment.refetch} />
                    <Button label="Back" variant="ghost" onPress={() => close()} />
                </View>
            </View>
        );
    }

    if (!appointment.data || !branches.data) {
        return (
            <View style={styles.state}>
                <Text variant="subhead" tone="muted">
                    {t('Reading the booking…')}
                </Text>
            </View>
        );
    }

    if (appointment.data.status !== 'booked') {
        return (
            <View style={styles.state}>
                <Banner
                    tone="warning"
                    message={t('This booking has moved on and can no longer be edited.')}
                />
                <View style={styles.actions}>
                    <Button label="Back" variant="ghost" onPress={() => close()} />
                </View>
            </View>
        );
    }

    return (
        <BookingScreen
            key={`reschedule:${appointment.data.id}`}
            patient={draftFor(appointment.data.patient)}
            rescheduling={appointment.data}
            branchId={appointment.data.branchId}
            branches={branches.data}
            schedule={schedule.data}
            durationOptions={settings.data?.durationOptions ?? [15, 30, 45]}
            defaultDuration={appointment.data.durationMinutes}
            dateKey={todayKey()}
            nowMinutes={nowMinutes}
            onBack={() => close()}
            onBooked={() => {
                appointment.refetch();
                close(true);
            }}
            onCancelled={() => {
                appointment.refetch();
                close(true);
            }}
        />
    );
}

const styles = StyleSheet.create({
    state: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[3],
        paddingHorizontal: size.gutter,
        backgroundColor: color.canvas,
    },
    actions: { flexDirection: 'row', gap: space[2] },
});
