import type { LabStatus } from '@lustre/shared';
import { StyleSheet, View } from 'react-native';
import { Switch } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, space, Text } from '../../../theme';
import { LabIcon } from './icons';

export function LabTag({ status }: { status: LabStatus | null }) {
    const t = useT();
    if (status !== 'pending') return null;
    return (
        <View accessible accessibilityRole="image" accessibilityLabel={t('Lab pending')} style={styles.tag}>
            <LabIcon size={13} stroke={color.due} width={2.2} />
        </View>
    );
}

export type LabSwitchProps = {
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled?: boolean;
    testID?: string;
};

export function LabSwitch({ value, onValueChange, disabled = false, testID }: LabSwitchProps) {
    const t = useT();
    return (
        <View style={styles.switchRow}>
            <LabIcon size={17} stroke={value ? color.ink : color.muted} />
            <View style={styles.switchText}>
                <Text variant="callout" weight="medium">
                    {t('Needs lab')}
                </Text>
                <Text variant="caption" tone="muted">
                    {t('A crown, bridge or denture that has to be back before the visit.')}
                </Text>
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                disabled={disabled}
                accessibilityLabel="Needs lab"
                testID={testID}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    tag: {
        alignSelf: 'flex-start',
        padding: space[1],
        borderRadius: radius.sm,
        backgroundColor: color.dueSoft,
    },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    switchText: { flex: 1, gap: space[0.5] },
});
