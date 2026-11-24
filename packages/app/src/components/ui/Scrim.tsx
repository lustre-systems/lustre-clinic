import type { Animated as AnimatedTypes } from 'react-native';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { color } from '../../theme';

export type ScrimProps = {
    opacity?: AnimatedTypes.AnimatedInterpolation<number> | AnimatedTypes.Value;
    onPress?: () => void;
    closeLabel?: string;
};

export function Scrim({ opacity, onPress, closeLabel = 'Close' }: ScrimProps) {
    return (
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, opacity ? { opacity } : null]}>
            <Pressable
                style={StyleSheet.absoluteFill}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                accessibilityViewIsModal
            />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    scrim: { backgroundColor: color.scrim },
});
