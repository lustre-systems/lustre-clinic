import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Dot } from '../../../components/ui';
import { useLocale, useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import { slotProgress } from '../chair';
import type { Appointment } from '../data';
import { formatDuration, minutesOfDay, time12 } from '../time';
import { ChairProgress } from './ChairProgress';
import { CheckIcon, ClockIcon, ProcedureIcon } from './icons';

export type NowCardProps = {
    active: Appointment | null;
    next: Appointment | null;
    nowMinutes: number;
    procedure?: string;
    seatedAt?: string;
    onCheckIn: (appointment: Appointment) => void;
    onOpen: (appointment: Appointment) => void;
    onOpenRecord: (patientId: string) => void;
    checkingInId: string | null;
};

function Card({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
    if (!onPress) return <View style={styles.card}>{children}</View>;

    return (
        <Pressable
            accessible={false}
            onPress={onPress}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
            {children}
        </Pressable>
    );
}

function Name({
    appointment,
    onOpenRecord,
}: {
    appointment: Appointment;
    onOpenRecord: (id: string) => void;
}) {
    const t = useT();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Open {name}'s record", { name: appointment.patient.name })}
            onPress={() => onOpenRecord(appointment.patient.id)}
            style={({ pressed }) => [styles.name, pressed && styles.namePressed]}
        >
            <Text variant="title" weight="semibold" tone="inverse" numberOfLines={1}>
                {appointment.patient.name}
            </Text>
        </Pressable>
    );
}

function StartedAt({ appointment }: { appointment: Appointment }) {
    const { time, meridiem } = time12(appointment.startsAt);
    return (
        <Text variant="eyebrow" tone="muted" style={styles.startedAt}>
            {`${time} ${meridiem}`}
        </Text>
    );
}

export function NowCard({
    active,
    next,
    nowMinutes,
    procedure,
    seatedAt,
    onCheckIn,
    onOpen,
    onOpenRecord,
    checkingInId,
}: NowCardProps) {
    const t = useT();
    const locale = useLocale();
    if (active) {
        const inChair = active.status === 'checked_in';
        const progress = slotProgress(active, nowMinutes, seatedAt);

        return (
            <Card onPress={() => onOpen(active)}>
                <View style={styles.eyebrowRow}>
                    <Dot tone={inChair ? 'live' : 'due'} size={7} />
                    <Text variant="eyebrow" tone={inChair ? 'live' : 'due'}>
                        {t(inChair ? 'IN THE CHAIR' : 'AT THE DESK')}
                    </Text>
                    <StartedAt appointment={active} />
                </View>

                <Name appointment={active} onOpenRecord={onOpenRecord} />

                <View style={styles.detail}>
                    {active.note == null && procedure == null ? <ClockIcon /> : <ProcedureIcon />}
                    <Text variant="callout" tone="muted" numberOfLines={1} style={styles.detailText}>
                        {active.note ?? procedure ?? progress.window}
                    </Text>
                </View>

                {inChair ? <ChairProgress appointment={active} seatedAt={seatedAt} /> : null}

                <Button
                    label={inChair ? 'Finish visit' : 'Take payment'}
                    variant="inverse"
                    size="md"
                    block
                    icon={<CheckIcon size={17} stroke={color.ink} />}
                    style={styles.action}
                    onPress={() => onOpen(active)}
                />
            </Card>
        );
    }

    if (next) {
        const until = minutesOfDay(next.startsAt) - nowMinutes;
        const { time, meridiem } = time12(next.startsAt, locale);

        return (
            <Card onPress={() => onOpen(next)}>
                <View style={styles.eyebrowRow}>
                    <Dot tone="accent" size={7} />
                    <Text variant="eyebrow" tone="muted">
                        {t('NEXT UP')}
                    </Text>
                    <StartedAt appointment={next} />
                </View>

                <Name appointment={next} onOpenRecord={onOpenRecord} />

                <View style={styles.detail}>
                    <ClockIcon />
                    <Text variant="callout" tone="muted" style={styles.detailText}>
                        {until > 0
                            ? t('{time} · in {duration}', {
                                  time: `${time} ${meridiem}`,
                                  duration: formatDuration(until),
                              })
                            : t('{time} · {duration} late', {
                                  time: `${time} ${meridiem}`,
                                  duration: formatDuration(Math.abs(until)),
                              })}
                    </Text>
                </View>

                <Button
                    label="Check in"
                    variant="inverse"
                    size="md"
                    block
                    icon={<CheckIcon size={17} stroke={color.ink} />}
                    style={styles.action}
                    loading={checkingInId === next.id}
                    onPress={() => onCheckIn(next)}
                />
            </Card>
        );
    }

    return (
        <View style={[styles.card, styles.empty]}>
            <Text variant="eyebrow" tone="muted">
                {t('THE CHAIR')}
            </Text>
            <Text variant="headline" weight="medium" tone="inverse">
                {t('Nobody in the chair')}
            </Text>
            <Text variant="subhead" tone="muted">
                {t('Nothing left to check in today.')}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: size.bleed,
        padding: space[5],
        backgroundColor: color.ink,
        borderRadius: radius.xl3,
    },
    cardPressed: { backgroundColor: color.ink2 },
    empty: { gap: space[1], padding: space[5] },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    startedAt: { marginStart: 'auto' },
    name: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: space[3.5] },
    namePressed: { opacity: 0.6 },
    detail: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginTop: space[1.5] },
    detailText: { flex: 1 },
    action: { marginTop: space[4] },
});
