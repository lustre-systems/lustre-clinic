import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLYPH } from '../components/domain';
import { IconButton } from '../components/ui';
import { color, space } from '../theme';
import type { SnoozeStore } from './bannerSnoozeStore';

export function SnoozeActions({
    store,
    testID,
    children,
}: {
    store: SnoozeStore;
    testID: string;
    children: ReactNode;
}) {
    return (
        <View style={styles.actions}>
            {children}
            <IconButton
                accessibilityLabel="Dismiss"
                icon={<GLYPH.close size={16} strokeWidth={2.2} color={color.ink2} />}
                variant="bare"
                onPress={store.snooze}
                testID={testID}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    actions: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
});
