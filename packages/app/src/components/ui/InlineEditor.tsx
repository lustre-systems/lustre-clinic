import { useRef, useState } from 'react';
import type { KeyboardTypeOptions } from 'react-native';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useT } from '../../i18n';
import type { TextVariant } from '../../theme';
import { color, containsArabic, font, size, space, Text, type } from '../../theme';
import { Placeholder } from './Placeholder';

export type InlineEditorProps = {
    value: string;
    onCommit: (value: string) => void;
    placeholder?: string;
    variant?: TextVariant;
    keyboardType?: KeyboardTypeOptions;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
};

export function InlineEditor({
    value,
    onCommit,
    placeholder,
    variant = 'body',
    keyboardType,
    disabled = false,
    accessibilityLabel,
    testID,
}: InlineEditorProps) {
    const t = useT();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const abandoned = useRef(false);

    function begin() {
        setDraft(value);
        abandoned.current = false;
        setEditing(true);
    }

    function commit() {
        setEditing(false);
        if (abandoned.current) return;
        if (draft !== value) onCommit(draft);
    }

    function revert() {
        abandoned.current = true;
        setDraft(value);
        setEditing(false);
    }

    if (!editing) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : value}
                accessibilityHint={t('Double tap to edit')}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={begin}
                testID={testID}
                style={({ pressed }) => [
                    styles.display,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                ]}
            >
                <Text variant={variant} tone={value ? 'ink' : 'muted'}>
                    {value || (placeholder ? t(placeholder) : '')}
                </Text>
            </Pressable>
        );
    }

    return (
        <View style={styles.editing}>
            <TextInput
                autoFocus
                value={draft}
                onChangeText={setDraft}
                onBlur={commit}
                onSubmitEditing={commit}
                onKeyPress={(event) => {
                    if (event.nativeEvent.key === 'Escape') revert();
                }}
                keyboardType={keyboardType}
                returnKeyType="done"
                accessibilityLabel={t(accessibilityLabel ?? placeholder ?? '') || undefined}
                style={[
                    type[variant],
                    styles.input,
                    { fontFamily: containsArabic(draft) ? font.arabic.regular : font.sans.regular },
                ]}
            />
            <Placeholder text={placeholder} visible={!draft} variant={variant} />
        </View>
    );
}

const styles = StyleSheet.create({
    display: { justifyContent: 'center', minHeight: size.row, paddingHorizontal: space[1] },
    editing: { justifyContent: 'center', minHeight: size.row },
    input: {
        color: color.ink,
        paddingHorizontal: space[1],
        paddingVertical: space[1],
        borderBottomWidth: 1.5,
        borderBottomColor: color.ink,
    },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.32 },
});
