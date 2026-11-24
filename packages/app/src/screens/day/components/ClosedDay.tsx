import { ScrollView, StyleSheet, View } from 'react-native';
import { Callout, type PullToRefresh, SectionLabel } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import type { Appointment } from '../data';
import { weekdayName, weekdayOf } from '../time';
import { AppointmentRow } from './AppointmentRow';

export type ClosedDayProps = {
    dateKey: string;
    appointments: readonly Appointment[];
    onSelect: (appointment: Appointment) => void;
    pull?: PullToRefresh;
    chairId?: string | null;
};

export function ClosedDay({ dateKey, appointments, onSelect, pull, chairId = null }: ClosedDayProps) {
    const t = useT();
    return (
        <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={pull?.refreshControl}
            {...pull?.scrollProps}
        >
            <View style={styles.panel}>
                <Text variant="title3" weight="semibold">
                    {t('Closed')}
                </Text>
                <Text variant="body" tone="muted" style={styles.body}>
                    {t('The clinic does not open on {day}s. Change that in Settings → Working hours.', {
                        day: t(weekdayName(weekdayOf(dateKey))),
                    })}
                </Text>
            </View>

            {appointments.length > 0 ? (
                <View style={styles.booked}>
                    <SectionLabel count={appointments.length}>BOOKED ANYWAY</SectionLabel>
                    <Callout tone="warning">
                        These are on a day the clinic is closed. They were either booked before the hours
                        changed, or booked deliberately.
                    </Callout>
                    <View style={styles.rows}>
                        {appointments.map((appointment) => (
                            <AppointmentRow
                                key={appointment.id}
                                appointment={appointment}
                                inChair={appointment.id === chairId}
                                onPress={() => onSelect(appointment)}
                            />
                        ))}
                    </View>
                </View>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: { padding: size.gutter, gap: space[6] },
    panel: {
        alignItems: 'center',
        gap: space[2],
        padding: space[7],
        backgroundColor: color.canvas,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: color.line,
        borderStyle: 'dashed',
    },
    body: { textAlign: 'center' },
    booked: { gap: space[3] },
    rows: { gap: space[2] },
});
