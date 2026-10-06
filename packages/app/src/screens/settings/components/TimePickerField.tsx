/**
 * Opening and closing time, on the platform's own picker.
 *
 * The control it replaces was a `ui/Select` of hardcoded half-hour slots in a
 * full-height sheet — no selected state, no confirm, and a clinic opening at
 * 14:15 could not say so. The native dialog answers all of that for free: it
 * opens on the current value, marks it, has explicit OK and Cancel, sizes
 * itself, and counts in minutes rather than in whatever granularity someone
 * once hardcoded. Settings is the lowest-traffic screen in the app and these
 * hours change roughly never, which is the whole argument against building a
 * wheel by hand for it.
 *
 * **`is24Hour: false` is the point.** The native picker otherwise follows the
 * *device's* 12/24-hour setting, which would put a 24-hour clock inside the one
 * control that edits a time while every other surface in the app shows 12-hour.
 * Android takes the override, so the app's decision wins and the device's is
 * ignored. That is what makes the native picker compatible with "no 24-hour
 * anywhere" rather than an exception to it.
 *
 * Android only, deliberately: `DateTimePickerAndroid.open` is the dialog form,
 * and the app has no iOS build (`scripts/` is adb and gradle throughout). iOS
 * would need the element form, and its spinner cannot be forced off the
 * device's 24-hour setting — if iOS is ever built, that conflict has to be
 * settled before this component is reused there.
 *
 * It lives in the cluster rather than in `ui/` because `ui/boundaries.test.ts`
 * allows a primitive to import only react, react-native, the theme and its own
 * siblings, and this needs a native module outside that list. Promoting it to
 * a `ui/TimeField` means widening that allowlist, which
 * is a bigger call than one screen's picker.
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { formatClock12 } from '../../../components/domain';
import { Chevron, Field } from '../../../components/ui';
import { useLocale } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';

export type TimePickerFieldProps = {
    label: string;
    /** Minutes since midnight. */
    value: number;
    onChange: (minutes: number) => void;
    hint?: string;
    error?: string;
    disabled?: boolean;
    testID?: string;
};

/**
 * The picker deals in a `Date`, but the value is a clinic wall-clock time, not
 * an instant. Pinned to GMT on both sides (`timeZoneName: 'GMT'`) so the
 * phone's zone, and any DST jump in it, never reaches the numbers.
 */
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

    /**
     * Whether the dialog is already up. The control has no state to bail out
     * of — the picker is opened imperatively — and the row stays under the
     * finger until the native dialog has been raised, so a double tap asks for
     * two of them and Cancel then dismisses one and leaves the other.
     */
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
                // 'dismissed' is Cancel and the back gesture both; only 'set'
                // is the user saying yes.
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
