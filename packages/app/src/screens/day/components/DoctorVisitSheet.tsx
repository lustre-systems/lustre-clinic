import { StyleSheet, View } from 'react-native';
import { StatusPill } from '../../../components/domain';
import { Button, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, space, Text } from '../../../theme';
import type { Appointment } from '../data';
import { dateKey, formatSpan, minutesOfDay, relativeDayLabel } from '../time';
import { PlanSummary } from './PlanSummary';

export type DoctorVisitSheetProps = {
    visible: boolean;
    appointment: Appointment | null;
    onClose: () => void;
    onOpenRecord: (appointment: Appointment) => void;
    onRecord: (appointment: Appointment) => void;
    onEditBooking: (appointment: Appointment) => void;
    recording?: boolean;
    onClosed?: () => void;
    inChair?: boolean;
};

export function DoctorVisitSheet({
    visible,
    appointment,
    onClose,
    onOpenRecord,
    onRecord,
    onEditBooking,
    recording = false,
    onClosed,
    inChair = false,
}: DoctorVisitSheetProps) {
    const t = useT();
    const arrived =
        appointment?.status === 'checked_in' ||
        appointment?.status === 'awaiting_payment' ||
        appointment?.status === 'done';
    const booked = appointment?.status === 'booked';

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            onClosed={onClosed}
            testID="doctor-visit-sheet"
            footer={
                appointment ? (
                    <View style={styles.footer}>
                        {arrived ? (
                            <Button
                                label={
                                    appointment.status === 'done'
                                        ? 'Edit what was done'
                                        : 'Record what was done'
                                }
                                block
                                loading={recording}
                                onPress={() => onRecord(appointment)}
                                testID="doctor-record"
                            />
                        ) : null}
                        {booked ? (
                            <Button
                                label="Edit booking"
                                block
                                onPress={() => onEditBooking(appointment)}
                                testID="doctor-edit-booking"
                            />
                        ) : null}
                        <Button
                            label="Open patient record"
                            variant={arrived || booked ? 'ghost' : undefined}
                            block
                            onPress={() => onOpenRecord(appointment)}
                            testID="open-record"
                        />
                    </View>
                ) : null
            }
        >
            {appointment ? (
                <>
                    <Identity appointment={appointment} inChair={inChair} />

                    <PlanSummary procedures={appointment.procedures} label="IN FOR" />

                    {appointment.note ? (
                        <View style={styles.note}>
                            <Text variant="eyebrow" tone="muted">
                                {t('NOTE FROM THE DESK')}
                            </Text>
                            <Text variant="body" tone="ink2" style={styles.noteText}>
                                {appointment.note}
                            </Text>
                        </View>
                    ) : null}
                </>
            ) : null}
        </Sheet>
    );
}

function Identity({ appointment, inChair }: { appointment: Appointment; inChair: boolean }) {
    const t = useT();
    return (
        <View style={styles.identity}>
            <View style={styles.tile}>
                <Text variant="title3" script="sans" weight="semibold" tone="inverse">
                    {String(appointment.durationMinutes)}
                </Text>
                <Text variant="tag" tone="inverse" style={styles.tileSub}>
                    {t('MIN')}
                </Text>
            </View>

            <View style={styles.who}>
                <Text variant="title2" weight="semibold" numberOfLines={2}>
                    {appointment.patient.name}
                </Text>
                <Text variant="subhead" tone="muted">
                    {slotLabel(appointment)}
                </Text>
                <View style={styles.status}>
                    <StatusPill status={appointment.status} inChair={inChair} withDot />
                </View>
            </View>
        </View>
    );
}

function slotLabel(appointment: Appointment): string {
    const start = new Date(appointment.startsAt);
    const from = minutesOfDay(appointment.startsAt);
    return `${relativeDayLabel(dateKey(start))} · ${formatSpan(from, from + appointment.durationMinutes)}`;
}

const styles = StyleSheet.create({
    footer: { gap: space[2] },
    identity: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3.5] },
    tile: {
        width: 64,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        borderRadius: radius.xl2,
        backgroundColor: color.ink,
    },
    tileSub: { opacity: 0.62 },
    who: { flex: 1, gap: space[1] },
    status: { flexDirection: 'row', paddingTop: space[1] },

    note: {
        gap: space[1.5],
    },
    noteText: {
        lineHeight: 21,
        padding: space[3],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.canvas,
    },
});
