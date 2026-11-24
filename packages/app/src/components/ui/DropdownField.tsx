import { useRef, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, useWindowDimensions, type View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, size, space, Text } from '../../theme';
import { Chevron } from './Chevron';
import { DropdownMenu, type DropdownOption } from './DropdownMenu';
import { Field } from './Field';
import type { MenuAnchor } from './PopoverMenu';

export type DropdownFieldProps<T extends string> = {
    options: readonly DropdownOption<T>[];
    value: T;
    onChange: (value: T) => void;
    label?: string;
    accessibilityLabel?: string;
    hint?: string;
    disabled?: boolean;
    testID?: string;
};

export function DropdownField<T extends string>({
    options,
    value,
    onChange,
    label,
    accessibilityLabel = label,
    hint,
    disabled = false,
    testID,
}: DropdownFieldProps<T>) {
    const t = useT();
    const trigger = useRef<View>(null);
    const window = useWindowDimensions();
    const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
    const [open, setOpen] = useState(false);
    const selected = options.find((option) => option.value === value);

    function show() {
        trigger.current?.measureInWindow((x, y, width, height) => {
            setAnchor({
                top: y + height + space[1],
                start: I18nManager.isRTL ? window.width - x - width : x,
                width,
            });
            setOpen(true);
        });
    }

    return (
        <Field label={label} hint={hint}>
            <Pressable
                ref={trigger}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
                accessibilityValue={{ text: selected ? t(selected.label) : '' }}
                accessibilityState={{ disabled, expanded: open }}
                disabled={disabled}
                onPress={show}
                testID={testID}
                style={({ pressed }) => [
                    styles.control,
                    open && styles.open,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                ]}
            >
                <Text variant="body" numberOfLines={1} style={styles.value}>
                    {selected ? t(selected.label) : ''}
                </Text>
                <Chevron direction={open ? 'up' : 'down'} />
            </Pressable>

            <DropdownMenu
                visible={open}
                onClose={() => setOpen(false)}
                options={options}
                value={value}
                onChange={onChange}
                anchor={anchor ?? undefined}
                motion="drop"
                accessibilityLabel={accessibilityLabel}
                testID={testID ? `${testID}-menu` : undefined}
            />
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
    open: { borderColor: color.ink },
    value: { flex: 1 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.32 },
});
