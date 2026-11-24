import { StyleSheet, View } from 'react-native';
import { color, size, space } from '../../theme';
import { Button } from './Button';
import { useKeyboardHeight } from './useKeyboardHeight';

export type ActionBarProps = {
    primaryLabel: string;
    onPrimary: () => void;
    primaryLoading?: boolean;
    primaryDisabled?: boolean;
    destructive?: boolean;
    secondaryLabel?: string;
    onSecondary?: () => void;
    testID?: string;
};

export function ActionBar({
    primaryLabel,
    onPrimary,
    primaryLoading = false,
    primaryDisabled = false,
    destructive = false,
    secondaryLabel,
    onSecondary,
    testID,
}: ActionBarProps) {
    const keyboard = useKeyboardHeight();

    return (
        <View
            style={[styles.bar, { paddingBottom: keyboard > 0 ? keyboard + space[3] : space[6] }]}
            testID={testID}
        >
            {secondaryLabel ? (
                <View style={styles.secondary}>
                    <Button
                        label={secondaryLabel}
                        variant="secondary"
                        onPress={onSecondary}
                        disabled={primaryLoading}
                        block
                    />
                </View>
            ) : null}

            <View style={secondaryLabel ? styles.primary : styles.only}>
                <Button
                    label={primaryLabel}
                    variant={destructive ? 'danger' : 'primary'}
                    onPress={onPrimary}
                    loading={primaryLoading}
                    disabled={primaryDisabled}
                    block
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignSelf: 'stretch',
        gap: space[2],
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        borderTopWidth: 1,
        borderTopColor: color.hair,
        backgroundColor: color.canvas,
    },
    secondary: { flex: 1 },
    primary: { flex: 1.6 },
    only: { flex: 1 },
});
