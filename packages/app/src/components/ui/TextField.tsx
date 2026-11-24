import { forwardRef, useState } from 'react';
import type { TextInputProps } from 'react-native';
import { StyleSheet, TextInput, View } from 'react-native';
import { useT } from '../../i18n';
import { color, containsArabic, font, radius, size, space, type } from '../../theme';
import type { FieldLayout } from './Field';
import { Field } from './Field';
import { Placeholder } from './Placeholder';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
    label?: string;
    required?: boolean;
    hint?: string;
    error?: string;
    due?: boolean;
    inline?: boolean;
    layout?: FieldLayout;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
    { label, required, hint, error, due, inline = false, layout, placeholder, ...input },
    ref,
) {
    const t = useT();
    const [focused, setFocused] = useState(false);
    const shown = placeholder ? t(placeholder) : undefined;
    const arabic = containsArabic(input.value || shown || '');

    return (
        <Field label={label} required={required} hint={hint} error={error} due={due} layout={layout}>
            <View
                style={[
                    styles.box,
                    inline ? styles.inline : styles.boxed,
                    focused && (inline ? styles.inlineFocused : styles.focused),
                    error ? styles.errored : null,
                ]}
            >
                <View style={styles.inputWrap}>
                    <TextInput
                        ref={ref}
                        accessibilityLabel={t(label ?? shown ?? '') || undefined}
                        {...input}
                        onFocus={(event) => {
                            setFocused(true);
                            input.onFocus?.(event);
                        }}
                        onBlur={(event) => {
                            setFocused(false);
                            input.onBlur?.(event);
                        }}
                        style={[
                            styles.input,
                            { fontFamily: arabic ? font.arabic.regular : font.sans.regular },
                        ]}
                    />
                    <Placeholder text={placeholder} visible={!input.value && !focused} />
                </View>
            </View>
        </Field>
    );
});

const styles = StyleSheet.create({
    box: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
    boxed: {
        minHeight: size.control,
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    focused: { borderColor: color.ink },
    errored: { borderColor: color.danger },
    inline: { minHeight: size.row, borderBottomWidth: 1, borderBottomColor: color.hair },
    inlineFocused: { borderBottomColor: color.ink },
    inputWrap: { flex: 1, justifyContent: 'center' },
    input: { ...type.body, alignSelf: 'stretch', color: color.ink, paddingVertical: space[2] },
});
