import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, size, space, Text } from '../../theme';
import { Chevron } from './Chevron';
import { Field } from './Field';
import { Sheet } from './Sheet';

export type SelectOption<T extends string> = { value: T; label: string };

export type SelectProps<T extends string> = {
    options: readonly SelectOption<T>[];
    value: T | null;
    onChange: (value: T) => void;
    placeholder?: string;
    label?: string;
    required?: boolean;
    hint?: string;
    error?: string;
    disabled?: boolean;
    sheetTitle?: string;
    testID?: string;
};

export function Select<T extends string>({
    options,
    value,
    onChange,
    placeholder = 'Select',
    label,
    required,
    hint,
    error,
    disabled = false,
    sheetTitle,
    testID,
}: SelectProps<T>) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const selected = options.find((option) => option.value === value);
    const shownPlaceholder = t(placeholder);

    return (
        <Field label={label} required={required} hint={hint} error={error}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label ? t(label) : shownPlaceholder}
                accessibilityValue={{ text: selected?.label ?? shownPlaceholder }}
                accessibilityState={{ disabled, expanded: open }}
                disabled={disabled}
                onPress={() => setOpen(true)}
                testID={testID}
                style={({ pressed }) => [
                    styles.control,
                    error ? styles.errored : null,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                ]}
            >
                <Text variant="body" tone={selected ? 'ink' : 'muted'} numberOfLines={1} style={styles.value}>
                    {selected?.label ?? shownPlaceholder}
                </Text>
                <Chevron direction="down" />
            </Pressable>

            <Sheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label ?? placeholder}>
                <View style={styles.options}>
                    {options.map((option) => {
                        const isSelected = option.value === value;
                        return (
                            <Pressable
                                key={option.value}
                                accessibilityRole="menuitem"
                                accessibilityState={{ selected: isSelected }}
                                onPress={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                            >
                                <Text
                                    variant="body"
                                    weight={isSelected ? 'semibold' : 'regular'}
                                    style={styles.value}
                                >
                                    {option.label}
                                </Text>
                                {isSelected ? (
                                    <Text variant="body" tone="accent">
                                        {'✓'}
                                    </Text>
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>
            </Sheet>
        </Field>
    );
}

const styles = StyleSheet.create({
    control: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        minHeight: size.control,
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    value: { flex: 1 },
    errored: { borderColor: color.danger },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.32 },
    options: { alignSelf: 'stretch' },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        minHeight: size.row,
        paddingVertical: space[2],
    },
});
