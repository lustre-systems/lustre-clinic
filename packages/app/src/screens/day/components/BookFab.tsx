import { Pressable, StyleSheet } from 'react-native';
import { color, radius, shadow, size, space } from '../../../theme';
import { PlusIcon } from './icons';

export type BookFabProps = {
    onPress: () => void;
};

export function BookFab({ onPress }: BookFabProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Book an appointment or a walk-in"
            onPress={onPress}
            style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
            testID="book-fab"
        >
            <PlusIcon size={24} stroke={color.inverse} />
        </Pressable>
    );
}

const FAB = 52;

const styles = StyleSheet.create({
    fab: {
        position: 'absolute',
        end: size.gutter,
        bottom: space[6],
        width: FAB,
        height: FAB,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.accent,
        boxShadow: shadow.fab,
    },
    pressed: { opacity: 0.9 },
});
