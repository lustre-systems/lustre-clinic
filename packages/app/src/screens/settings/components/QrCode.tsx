import { qrModules } from '@lustre/shared';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color, radius } from '../../../theme';

const QUIET = 4;

export function QrCode({ value, size, testID }: { value: string; size: number; testID?: string }) {
    const { path, count } = useMemo(() => {
        const modules = qrModules(value);
        let d = '';
        modules.forEach((row, y) => {
            row.forEach((dark, x) => {
                if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
            });
        });
        return { path: d, count: modules.length + QUIET * 2 };
    }, [value]);

    return (
        <View style={[styles.frame, { width: size, height: size }]} testID={testID}>
            <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
                <Path d={path} fill={color.ink} />
            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    frame: { backgroundColor: color.surface, borderRadius: radius.lg, overflow: 'hidden' },
});
