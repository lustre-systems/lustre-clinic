import type { Tooth } from '@lustre/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SearchField, Sheet } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, space, Text } from '../../../theme';
import { QUADRANTS } from '../procedures';

export type ToothSheetProps = {
    visible: boolean;
    onClose: () => void;
    onPick: (tooth: Tooth | null) => void;
    required?: string;
};

export function ToothSheet({ visible, onClose, onPick, required }: ToothSheetProps) {
    const t = useT();
    const [term, setTerm] = useState('');
    const query = term.trim().toUpperCase();

    const quadrants = QUADRANTS.map((quadrant) => ({
        ...quadrant,
        codes: query ? quadrant.codes.filter((code) => code.includes(query)) : quadrant.codes,
    })).filter((quadrant) => quadrant.codes.length > 0);

    function pick(tooth: Tooth | null) {
        if (!visible) return;
        onPick(tooth);
    }

    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title="Which tooth?"
            subtitle={
                required
                    ? t('{procedure} is done to a tooth. Pick the one it is for.', { procedure: required })
                    : 'Pick the tooth first, or skip if it does not apply.'
            }
            testID="tooth-sheet"
            footer={
                required ? undefined : (
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => pick(null)}
                        style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
                    >
                        <Text variant="subhead" weight="medium" tone="muted">
                            {t('No tooth assigned')}
                        </Text>
                    </Pressable>
                )
            }
        >
            <SearchField
                value={term}
                onChangeText={setTerm}
                onClear={() => setTerm('')}
                variant="sheet"
                placeholder="Search, e.g. UL6"
                autoCapitalize="characters"
                autoCorrect={false}
            />

            {quadrants.length === 0 ? (
                <Text variant="subhead" tone="muted">
                    {t('No matching teeth.')}
                </Text>
            ) : (
                <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
                    {quadrants.map((quadrant) => (
                        <View key={quadrant.key} style={styles.quadrant}>
                            <Text variant="eyebrow" tone="muted">
                                {quadrant.name.toUpperCase()}
                            </Text>
                            <View style={styles.teeth}>
                                {quadrant.codes.map((code) => (
                                    <Pressable
                                        key={code}
                                        accessibilityRole="button"
                                        accessibilityLabel={code}
                                        onPress={() => pick(code)}
                                        style={({ pressed }) => [styles.tooth, pressed && styles.pressed]}
                                    >
                                        <Text variant="caption" script="sans" weight="bold">
                                            {code}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>
                    ))}
                </ScrollView>
            )}
        </Sheet>
    );
}

const styles = StyleSheet.create({
    scroll: { maxHeight: 360 },
    quadrant: { gap: space[2], marginBottom: space[4] },
    teeth: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
    tooth: {
        width: '11.6%',
        minHeight: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    skip: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    pressed: { backgroundColor: color.surface2 },
});
