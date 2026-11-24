import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { space, Text } from '../../theme';

export type FieldLayout = 'stacked' | 'inline';

export type FieldProps = {
    label?: string;
    required?: boolean;
    hint?: string;
    error?: string;
    due?: boolean;
    layout?: FieldLayout;
    children: ReactNode;
};

export function Field({
    label,
    required = false,
    hint,
    error,
    due = false,
    layout = 'stacked',
    children,
}: FieldProps) {
    const t = useT();

    const labelBlock = label ? (
        <View style={styles.labelRow}>
            <Text variant="subhead" weight="medium" tone={error ? 'danger' : due ? 'due' : 'ink2'}>
                {t(label)}
            </Text>
            {required ? (
                <Text variant="subhead" tone="danger">
                    *
                </Text>
            ) : null}
        </View>
    ) : null;

    const footer =
        error || hint ? (
            <Text variant="footnote" tone={error ? 'danger' : 'muted'}>
                {t(error ?? hint ?? '')}
            </Text>
        ) : null;

    if (layout === 'inline') {
        return (
            <View style={styles.field}>
                <View style={styles.row}>
                    {labelBlock}
                    <View style={styles.control}>{children}</View>
                </View>
                {footer}
            </View>
        );
    }

    return (
        <View style={styles.field}>
            {labelBlock}
            {children}
            {footer}
        </View>
    );
}

const styles = StyleSheet.create({
    field: { alignSelf: 'stretch', gap: space[1.5] },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: space[0.5], flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    control: { flex: 1, minWidth: 0 },
});
