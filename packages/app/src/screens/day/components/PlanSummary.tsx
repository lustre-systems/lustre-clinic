import { StyleSheet, View } from 'react-native';
import { ToothGroupCard, type ToothGroupLine } from '../../../components/domain';
import { useT } from '../../../i18n';
import { border, color, radius, space, Text } from '../../../theme';
import { type AppointmentProcedure, useGeneralClinic } from '../data';
import { toothGroupsOf, toothPosition } from '../procedures';

export type PlanSummaryProps = {
    procedures: readonly AppointmentProcedure[];
    label: string;
};

export function PlanSummary({ procedures, label }: PlanSummaryProps) {
    const t = useT();
    const groups = toothGroupsOf(procedures);
    const general = useGeneralClinic();

    return (
        <>
            <View style={styles.head}>
                <Text variant="eyebrow" tone="muted">
                    {t(label)}
                </Text>
                <Text variant="footnote" tone="muted">
                    {procedures.length === 1
                        ? t('1 procedure')
                        : t('{count} procedures', { count: procedures.length })}
                </Text>
            </View>

            {groups.length === 0 ? (
                <View style={styles.blank}>
                    <Text variant="subhead" tone="muted">
                        {t('Nothing planned — it will be decided in the chair.')}
                    </Text>
                </View>
            ) : (
                <View style={styles.plan} testID="plan-summary">
                    {groups.map((group, index) => (
                        <View key={group.tooth ?? 'none'} style={index > 0 ? styles.divided : undefined}>
                            <ToothGroupCard
                                variant="row"
                                tooth={group.tooth}
                                position={toothPosition(group.tooth, general)}
                                lines={group.items.map(planLine)}
                            />
                        </View>
                    ))}
                </View>
            )}
        </>
    );
}

function planLine(procedure: AppointmentProcedure): ToothGroupLine {
    return {
        id: procedure.id,
        name: procedure.quantity > 1 ? `${procedure.name} × ${procedure.quantity}` : procedure.name,
        detail: procedure.note,
    };
}

const styles = StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    blank: { paddingBottom: space[1] },
    plan: {
        borderRadius: radius.xl2,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
        overflow: 'hidden',
    },
    divided: { borderTopWidth: border.hair, borderTopColor: color.hair },
});
