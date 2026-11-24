import type { AppointmentStatus } from '@lustre/shared';
import { StyleSheet, View } from 'react-native';
import { space } from '../../theme';
import { Dot, Tag } from '../ui';
import { statusLabel, statusTone } from './status';

export type { StatusTone } from './status';
export { statusCopy, statusLabel, statusTone } from './status';

export type StatusPillProps = {
    status: AppointmentStatus;
    inChair?: boolean;
    label?: string;
    withDot?: boolean;
    animated?: boolean;
    testID?: string;
};

export function StatusPill({
    status,
    inChair,
    label,
    withDot = false,
    animated = true,
    testID,
}: StatusPillProps) {
    const tone = statusTone(status, inChair);
    const seated = status === 'checked_in' && inChair === true;

    return (
        <View style={styles.row} testID={testID}>
            {withDot ? <Dot tone={tone} pulse={animated && status === 'checked_in'} /> : null}
            <Tag tone={tone} variant={seated ? 'filled' : 'outline'}>
                {label ?? statusLabel(status, inChair)}
            </Tag>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
});
