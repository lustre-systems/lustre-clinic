import { StyleSheet, View } from 'react-native';
import { StatusBadge } from '../../../components/domain';
import { useT } from '../../../i18n';
import { size, space, Text } from '../../../theme';
import { rowSummary } from '../agenda';
import type { Appointment } from '../data';
import { AgendaRow } from './Agenda';
import { ArrowForwardIcon } from './icons';

export type AfterThisProps = {
    appointments: readonly Appointment[];
    relativeToNow: boolean;
    onSelect: (appointment: Appointment) => void;
};

export function AfterThis({ appointments, relativeToNow, onSelect }: AfterThisProps) {
    const t = useT();
    if (appointments.length === 0) return null;

    return (
        <View style={styles.section}>
            <View style={styles.label}>
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
                    trailing={
                        <StatusBadge
                            status={appointment.status}
                            inChair={relativeToNow ? false : undefined}
                        />
                    }
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    section: { paddingHorizontal: size.gutter, marginTop: space[2] },
    label: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], minHeight: space[6] },
});
