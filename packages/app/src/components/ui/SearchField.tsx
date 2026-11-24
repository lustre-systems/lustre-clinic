import type { ReactNode } from 'react';
import { useState } from 'react';
import type { TextInputProps } from 'react-native';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useT } from '../../i18n';
import { color, containsArabic, font, radius, size, space, Text, type } from '../../theme';
import { Placeholder } from './Placeholder';

export type SearchFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
    value: string;
    onChangeText: (value: string) => void;
    variant?: 'inline' | 'sheet';
    onClear?: () => void;
    leading?: ReactNode;
};

export function SearchField({
    variant = 'inline',
    onClear,
    placeholder,
    leading,
    ...input
}: SearchFieldProps) {
    const t = useT();
    const shownPlaceholder = placeholder ? t(placeholder) : undefined;
    const [focused, setFocused] = useState(false);
    const arabic = containsArabic(input.value || shownPlaceholder || '');

    return (
        <View style={[styles.box, variant === 'sheet' ? styles.sheet : styles.inline]}>
            {leading ?? (
                <Text variant="callout" tone="muted">
                    {'⌕'}
                </Text>
            )}

            <View style={styles.inputWrap}>
                <TextInput
                    accessibilityLabel={shownPlaceholder}
                    {...input}
                    accessibilityRole="search"
                    returnKeyType="search"
                    autoCorrect={false}
                    onFocus={(event) => {
                        setFocused(true);
                        input.onFocus?.(event);
                    }}
                    onBlur={(event) => {
                        setFocused(false);
                        input.onBlur?.(event);
                    }}
                    style={[styles.input, { fontFamily: arabic ? font.arabic.regular : font.sans.regular }]}
                />
                <Placeholder text={shownPlaceholder} visible={!input.value && !focused} />
            </View>

            {input.value.length > 0 ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Clear search')}
                    hitSlop={10}
                    onPress={() => {
                        input.onChangeText('');
                        onClear?.();
                    }}
                >
                    <Text variant="callout" tone="muted">
                        {'✕'}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        gap: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
    },
    inline: {
        minHeight: size.control,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    sheet: { minHeight: 42, backgroundColor: color.canvas },
    inputWrap: { flex: 1, justifyContent: 'center' },
    input: { ...type.body, alignSelf: 'stretch', color: color.ink, paddingVertical: space[2] },
});
