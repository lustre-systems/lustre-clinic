import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { formatClock12 } from '../../../components/domain';
import { Chevron, Field } from '../../../components/ui';
import { useLocale } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';

export type TimePickerFieldProps = {
    label: string;
    value: number;
    onChange: (minutes: number) => void;
    hint?: string;
    error?: string;
    disabled?: boolean;
    testID?: string;
};

function dateAt(minutes: number): Date {
    return new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function TimePickerField({
    label,
    value,
    onChange,
    hint,
    error,
    disabled = false,
    testID,
}: TimePickerFieldProps) {
    const shown = formatClock12(value, useLocale());

    const asked = useRef(false);

    function open() {
        if (asked.current) return;
        asked.current = true;

        DateTimePickerAndroid.open({
            value: dateAt(value),
            mode: 'time',
            is24Hour: false,
            timeZoneName: 'GMT',
            onChange: (event, picked) => {
                asked.current = false;
                if (event.type !== 'set' || !picked) return;
                onChange(picked.getUTCHours() * 60 + picked.getUTCMinutes());
            },
        });
    }

    return (
        <Field label={label} hint={hint} error={error}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityValue={{ text: shown }}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={open}
                testID={testID}
                style={({ pressed }) => [
                    styles.control,
                    error ? styles.errored : null,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                ]}
            >
                <Text variant="body" numberOfLines={1} style={styles.value}>
                    {shown}
                </Text>
                <Chevron direction="down" />
            </Pressable>
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
});
