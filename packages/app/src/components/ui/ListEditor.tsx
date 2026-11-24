import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, size, space, Text } from '../../theme';
import { AddButton } from './AddButton';
import { IconButton } from './IconButton';
import { TextField } from './TextField';

export type ListEditorProps = {
    items: readonly string[];
    onChange: (items: string[]) => void;
    placeholder?: string;
    addLabel?: string;
    minItems?: number;
    minItemsHint?: string;
    testID?: string;
};

export function ListEditor({
    items,
    onChange,
    placeholder = 'Option',
    addLabel = 'Add option',
    minItems = 2,
    minItemsHint = 'Add at least two options.',
    testID,
}: ListEditorProps) {
    const t = useT();
    const [draft, setDraft] = useState('');

    function update(index: number, value: string) {
        onChange(items.map((item, current) => (current === index ? value : item)));
    }

    function remove(index: number) {
        onChange(items.filter((_, current) => current !== index));
    }

    function add() {
        const trimmed = draft.trim();
        if (!trimmed) return;
        onChange([...items, trimmed]);
        setDraft('');
    }

    return (
        <View style={styles.list} testID={testID}>
            {items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
                <View key={index} style={styles.row}>
                    <View style={styles.ordinal}>
                        <Text variant="caption" tone="muted">
                            {String(index + 1)}
                        </Text>
                    </View>

                    <View style={styles.input}>
                        <TextField
                            inline
                            value={item}
                            onChangeText={(value) => update(index, value)}
                            placeholder={placeholder}
                        />
                    </View>

                    <IconButton
                        variant="bare"
                        accessibilityLabel={t('Remove {name}', {
                            name: item || `${t('Option')} ${index + 1}`,
                        })}
                        onPress={() => remove(index)}
                        icon={
                            <Text variant="callout" tone="muted">
                                {'✕'}
                            </Text>
                        }
                    />
                </View>
            ))}

            <View style={styles.row}>
                <View style={styles.ordinal}>
                    <Text variant="caption" tone="muted">
                        {String(items.length + 1)}
                    </Text>
                </View>
                <View style={styles.input}>
                    <TextField
                        inline
                        value={draft}
                        onChangeText={setDraft}
                        placeholder={placeholder}
                        returnKeyType="done"
                        onSubmitEditing={add}
                    />
                </View>
            </View>

            <AddButton variant="full" label={addLabel} onPress={add} disabled={draft.trim().length === 0} />

            {items.length < minItems ? (
                <Text variant="footnote" tone="muted">
                    {minItemsHint}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    list: { alignSelf: 'stretch', gap: space[2] },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: size.row },
    ordinal: {
        width: 22,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },
    input: { flex: 1 },
});
