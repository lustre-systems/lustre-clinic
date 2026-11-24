import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Dot } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, shadow, size, space, Text } from '../../../theme';
import { slotProgress } from '../chair';
import type { Appointment } from '../data';
import { formatDuration, formatSpan, minutesOfDay, time12 } from '../time';
import { ChairProgress } from './ChairProgress';
import { CheckIcon, ClockIcon, ProcedureIcon } from './icons';

export type ChairStripProps = {
    appointment: Appointment;
    procedure?: string;
    seatedAt?: string;
    finishing: boolean;
    onOpen: (appointment: Appointment) => void;
    onOpenRecord: (patientId: string) => void;
    onFinish: (appointment: Appointment) => void;
};

export function ChairStrip({
    appointment,
    procedure,
    seatedAt,
    finishing,
    onOpen,
    onOpenRecord,
    onFinish,
}: ChairStripProps) {
    const t = useT();
    const starts = minutesOfDay(appointment.startsAt);

    return (
        <View style={styles.strip} testID="chair-strip">
            <View style={styles.stripHead}>
                <View style={styles.stripBody}>
                    <View style={styles.eyebrowRow}>
                        <Dot tone="wa" size={7} />
                        <Text variant="eyebrow" tone="successText">
                            {t('IN THE CHAIR')}
                        </Text>
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("Open {name}'s record", { name: appointment.patient.name })}
                        onPress={() => onOpenRecord(appointment.patient.id)}
                        style={({ pressed }) => [styles.stripName, pressed && styles.namePressed]}
                    >
                        <Text variant="headline" weight="semibold" numberOfLines={1}>
                            {appointment.patient.name}
                        </Text>
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('In the chair: {name}', { name: appointment.patient.name })}
                        onPress={() => onOpen(appointment)}
                    >
                        <Text variant="footnote" tone="muted" numberOfLines={1}>
                            {procedure ?? formatSpan(starts, starts + appointment.durationMinutes)}
                        </Text>
                    </Pressable>
                </View>

                <Button
                    label="Finish"
                    size="md"
                    loading={finishing}
                    icon={<CheckIcon size={13} stroke={color.inverse} />}
                    style={styles.finish}
                    onPress={() => onFinish(appointment)}
                />
            </View>

            <ChairProgress
                appointment={appointment}
                seatedAt={seatedAt}
                onDark={false}
                style={styles.stripProgress}
            />
        </View>
    );
}

export type ChairCardKind = 'chair' | 'waiting' | 'next';

export type ChairCardProps = {
    appointment: Appointment | null;
    kind: ChairCardKind;
    nowMinutes: number;
    procedure?: string;
    checkedInAt?: string;
    seatedAt?: string;
    finishing: boolean;
    onOpen: (appointment: Appointment) => void;
    onOpenRecord: (patientId: string) => void;
    onFinish: (appointment: Appointment) => void;
};

export function ChairCard({
    appointment,
    kind,
    nowMinutes,
    procedure,
    checkedInAt,
    seatedAt,
    finishing,
    onOpen,
    onOpenRecord,
    onFinish,
}: ChairCardProps) {
    const t = useT();
    if (!appointment) {
        return (
            <View style={[styles.card, styles.empty]} testID="chair-card">
                <Text variant="eyebrow" tone="muted">
                    {t('THE CHAIR')}
                </Text>
                <Text variant="headline" weight="medium" tone="inverse">
                    {t('Nobody waiting')}
                </Text>
                <Text variant="subhead" tone="muted">
                    {t('The day is done. Anyone new comes through the desk.')}
                </Text>
            </View>
        );
    }

    const eyebrow = EYEBROW[kind];
    const slot = time12(appointment.startsAt);
    const progress = slotProgress(appointment, nowMinutes, seatedAt);
    const until = minutesOfDay(appointment.startsAt) - nowMinutes;

    return (
        <View style={styles.card} testID="chair-card">
            <View style={styles.eyebrowRow}>
                <Dot tone={eyebrow.dot} size={7} pulse={eyebrow.pulse} />
                <Text variant="eyebrow" tone={eyebrow.tone}>
                    {t(eyebrow.label)}
                </Text>
                {kind === 'waiting' ? null : (
                    <Text variant="eyebrow" tone="muted" style={styles.eyebrowEnd}>
                        {`${slot.time} ${slot.meridiem}`}
                    </Text>
                )}
            </View>

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

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t(eyebrow.label)}: ${appointment.patient.name}`}
                onPress={() => onOpen(appointment)}
            >
                <View style={styles.detail}>
                    <ProcedureIcon />
                    <Text variant="callout" tone="muted" numberOfLines={1} style={styles.detailText}>
                        {appointment.note ?? procedure ?? progress.window}
                    </Text>
                </View>
            </Pressable>

            {kind === 'chair' ? (
                <>
                    <ChairProgress appointment={appointment} seatedAt={seatedAt} />

                    <Button
                        label="Finish visit"
                        variant="inverse"
                        size="md"
                        block
                        loading={finishing}
                        icon={<CheckIcon size={17} stroke={color.ink} />}
                        style={styles.action}
                        onPress={() => onFinish(appointment)}
                    />
                </>
            ) : null}

            {kind === 'waiting' ? <Waited checkedInAt={checkedInAt} nowMinutes={nowMinutes} /> : null}

            {kind === 'next' ? (
                <View style={styles.footer}>
                    <Text variant="title2" weight="semibold" tone="inverse" style={styles.until}>
                        {until > 0
                            ? t('in {duration}', { duration: formatDuration(until) })
                            : t('{duration} late', { duration: formatDuration(-until) })}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function Waited({ checkedInAt, nowMinutes }: { checkedInAt?: string; nowMinutes: number }) {
    const t = useT();
    if (!checkedInAt) return null;

    const since = time12(checkedInAt);
    const waited = Math.max(0, nowMinutes - minutesOfDay(checkedInAt));

    return (
        <View style={styles.footer}>
            <Text variant="footnote" script="mono" weight="medium" tone="muted">
                {t('checked in {time}', { time: `${since.time} ${since.meridiem}` })}
            </Text>
            <View style={styles.waited}>
                <ClockIcon size={14} stroke={color.due} width={2.2} />
                <Text variant="subhead" weight="semibold" tone="due">
                    {t('waiting {duration}', { duration: formatDuration(waited) })}
                </Text>
            </View>
        </View>
    );
}

const EYEBROW = {
    chair: { label: 'IN THE CHAIR', tone: 'live', dot: 'live', pulse: false },
    waiting: { label: 'WAITING', tone: 'due', dot: 'due', pulse: true },
    next: { label: 'NEXT UP', tone: 'muted', dot: 'accent', pulse: false },
} as const satisfies Record<
    ChairCardKind,
    { label: string; tone: 'live' | 'due' | 'muted'; dot: 'live' | 'due' | 'accent'; pulse: boolean }
>;

const styles = StyleSheet.create({
    strip: {
        marginHorizontal: size.bleed,
        marginBottom: space[2.5],
        paddingVertical: space[3],
        paddingStart: space[3.5],
        paddingEnd: space[3],
        backgroundColor: color.surface,
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        boxShadow: shadow.pill,
    },
    stripHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    stripBody: { flex: 1, gap: space[1] },
    stripProgress: { marginTop: space[3] },
    finish: { borderRadius: radius.full, paddingHorizontal: space[3.5] },

    card: {
        marginHorizontal: size.bleed,
        padding: space[5],
        backgroundColor: color.ink,
        borderRadius: radius.xl3,
    },
    empty: { gap: space[1] },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    eyebrowEnd: { marginStart: 'auto' },
    name: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: space[3.5] },
    stripName: { alignSelf: 'flex-start', maxWidth: '100%' },
    namePressed: { opacity: 0.6 },
    detail: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginTop: space[1.5] },
    detailText: { flex: 1 },
    action: { marginTop: space[4] },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        marginTop: space[4],
        paddingTop: space[3.5],
        borderTopWidth: border.hair,
        borderTopColor: 'rgba(255,255,255,0.12)',
    },
    waited: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginStart: 'auto' },
    until: { marginStart: 'auto' },
});
