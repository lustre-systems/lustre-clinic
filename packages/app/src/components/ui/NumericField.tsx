import { forwardRef, useState } from 'react';
import type { TextInputProps } from 'react-native';
import { StyleSheet, TextInput, View } from 'react-native';
import { useIsRTL, useT } from '../../i18n';
import { color, font, radius, size as sizes, space, Text, type } from '../../theme';
import type { FieldLayout } from './Field';
import { Field } from './Field';
import { Placeholder } from './Placeholder';

export type NumericFieldVariant = 'display' | 'end' | 'inline';
export type NumericFieldSize = 'amount' | 'body';

const FIGURE_STYLE = { figure: 'figure', amount: 'amount', body: 'bodySize' } as const;

export type NumericFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor' | 'keyboardType'> & {
    label?: string;
    required?: boolean;
    hint?: string;
    error?: string;
    due?: boolean;
    keyboardType?: 'decimal-pad' | 'number-pad';
    variant?: NumericFieldVariant;
    size?: NumericFieldSize;
    layout?: FieldLayout;
    prefix?: string;
    suffix?: string;
};

export const NumericField = forwardRef<TextInput, NumericFieldProps>(function NumericField(
    {
        label,
        required,
        hint,
        error,
        due,
        keyboardType = 'decimal-pad',
        variant = 'end',
        size = 'amount',
        layout,
        prefix,
        suffix,
        placeholder,
        selectTextOnFocus = true,
        selection: suppliedSelection,
        onSelectionChange,
        ...input
    },
    ref,
) {
    const isRTL = useIsRTL();
    const t = useT();
    const [focused, setFocused] = useState(false);
    const [selection, setSelection] = useState<TextInputProps['selection']>();
    const display = variant === 'display';
    const figure = display ? 'figure' : size;

    return (
        <Field label={label} required={required} hint={hint} error={error} due={due} layout={layout}>
            <View
                style={[
                    styles.box,
                    variant === 'inline' ? styles.inline : styles.boxed,
                    display && styles.display,
                    focused && (variant === 'inline' ? styles.inlineFocused : styles.focused),
                    error ? styles.errored : null,
                ]}
            >
                {prefix ? (
                    <Text variant={display ? 'headline' : 'callout'} tone="muted">
                        {prefix}
                    </Text>
                ) : null}

                <View style={styles.inputWrap}>
                    <TextInput
                        ref={ref}
                        accessibilityLabel={t(label ?? placeholder ?? '') || undefined}
                        {...input}
                        keyboardType={keyboardType}
                        selectTextOnFocus={selectTextOnFocus}
                        selection={suppliedSelection ?? selection}
                        onFocus={(event) => {
                            setFocused(true);
                            input.onFocus?.(event);

                            if (selectTextOnFocus && !suppliedSelection && input.value) {
                                requestAnimationFrame(() => {
                                    setSelection({ start: 0, end: input.value?.length ?? 0 });
                                });
                            }
                        }}
                        onSelectionChange={(event) => {
                            setSelection(event.nativeEvent.selection);
                            onSelectionChange?.(event);
                        }}
                        onBlur={(event) => {
                            setFocused(false);
                            input.onBlur?.(event);
                        }}
                        style={[
                            styles.input,
                            styles[FIGURE_STYLE[figure]],
                            variant === 'end' && { textAlign: isRTL ? 'left' : 'right' },
                        ]}
                    />
                    <Placeholder
                        text={placeholder}
                        visible={!input.value && !focused}
                        variant={figure}
                        script="mono"
                        align={variant === 'end' ? 'end' : 'start'}
                    />
                </View>

                {suffix ? (
                    <Text variant="callout" tone="muted">
                        {suffix}
                    </Text>
                ) : null}
            </View>
        </Field>
    );
});

const styles = StyleSheet.create({
    box: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    boxed: {
        minHeight: sizes.control,
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    display: { minHeight: 62 },
    inline: { minHeight: sizes.row, borderBottomWidth: 1, borderBottomColor: color.hair },
    focused: { borderColor: color.ink },
    inlineFocused: { borderBottomColor: color.ink },
    errored: { borderColor: color.danger },
    inputWrap: { flex: 1, justifyContent: 'center' },
    input: { alignSelf: 'stretch', color: color.ink, paddingVertical: space[2] },
    figure: { ...type.figure, fontFamily: font.mono.medium },
    amount: { ...type.amount, fontFamily: font.mono.medium },
    bodySize: { ...type.body, fontFamily: font.mono.regular },
});
