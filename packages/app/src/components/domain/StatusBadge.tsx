import type { AppointmentStatus } from '@lustre/shared';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, space, Text } from '../../theme';
import { type BadgeTone, badgeTone, statusCopy } from './status';

export type StatusBadgeProps =
    | { status: AppointmentStatus; inChair?: boolean; label?: never; tone?: never }
    | { status?: never; inChair?: never; label: string; tone: BadgeTone };

export function StatusBadge(props: StatusBadgeProps) {
    const t = useT();
    const tone = props.tone ?? badgeTone(props.status, props.inChair);
    const label = props.label ?? statusCopy(props.status, props.inChair);

    return (
        <View style={[styles.badge, FILL[tone]]}>
            <View style={[styles.dot, { backgroundColor: DOT[tone] }]} />
            <Text variant="tag" weight="bold" tone={tone}>
                {t(label)}
            </Text>
        </View>
    );
}

const DOT: Record<BadgeTone, string> = {
    ink: color.ink,
    success: color.successText,
    due: color.due,
    muted: color.muted,
};

const FILL = StyleSheet.create({
    ink: { backgroundColor: color.surface2 },
    success: { backgroundColor: color.successSoft },
    due: { backgroundColor: color.dueSoft },
    muted: { backgroundColor: color.surface2 },
});

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[1.5],
        paddingVertical: 2,
        borderRadius: radius.full,
    },
    dot: { width: 5, height: 5, borderRadius: radius.full },
});
