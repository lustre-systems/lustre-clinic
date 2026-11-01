/**
 * What the doctor wants done at the patient's next visit — any number of
 * procedures, each with its tooth when it has one. The patient's next booking
 * takes them all: the earliest one already waiting gets the lines added when
 * the visit is saved, and if there is none the booking page offers them the
 * next time the desk books them.
 *
 * Its own file so the visit screen, already the longest in the app, gains a
 * slot rather than another section of markup.
 */
import type { Tooth } from '@lustre/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../../i18n';
import { border, color, radius, size, space, Text } from '../../../theme';
import { PlusIcon, XIcon } from './icons';

export type NextDraft = {
    procedureId: string;
    name: string;
    variant: string | null;
    tooth: Tooth | null;
};

export type NextProcedureBoxProps = {
    next: readonly NextDraft[];
    /** On a booking, as the server last said — not true of picks nobody has saved. */
    booked: boolean;
    onAdd: () => void;
    onChange: (index: number) => void;
    onRemove: (index: number) => void;
};

export function NextProcedureBox({ next, booked, onAdd, onChange, onRemove }: NextProcedureBoxProps) {
    const t = useT();

    return (
        <View style={styles.section}>
            <View style={styles.head}>
                <Text variant="eyebrow" tone="muted">
                    {t('NEXT PROCEDURE')}
                </Text>
            </View>

            {next.map((item, i) => (
                <View key={`${item.procedureId}:${item.tooth ?? ''}`} style={styles.card} testID="visit-next">
                    {item.tooth ? (
                        <View style={styles.tooth}>
                            <Text variant="footnote" script="mono" weight="bold">
                                {item.tooth}
                            </Text>
                        </View>
                    ) : null}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('Change next procedure')}
                        onPress={() => onChange(i)}
                        style={({ pressed }) => [styles.grow, pressed && styles.pressed]}
                    >
                        <Text variant="subhead" weight="semibold" numberOfLines={1}>
                            {item.variant ? `${item.name} · ${item.variant}` : item.name}
                        </Text>
                        <Text variant="footnote" tone="muted">
                            {t(booked ? 'On their next booking' : 'Their next booking will include it')}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('Clear next procedure')}
                        hitSlop={8}
                        onPress={() => onRemove(i)}
                        style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
                        testID="visit-next-clear"
                    >
                        <XIcon size={14} stroke={color.muted} />
                    </Pressable>
                </View>
            ))}

            <Pressable
                accessibilityRole="button"
                onPress={onAdd}
                style={({ pressed }) => [styles.choose, pressed && styles.pressed]}
                testID="visit-next-choose"
            >
                <View style={styles.glyph}>
                    <PlusIcon size={13} stroke={color.inverse} />
                </View>
                <Text variant="subhead" weight="semibold" tone="ink2">
                    {t(next.length === 0 ? 'Choose next procedure' : 'Add next procedure')}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: space[1.5] },
    head: { paddingHorizontal: size.gutter, paddingTop: space[4] },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: 56,
        marginHorizontal: size.gutter,
        paddingLeft: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    tooth: {
        paddingHorizontal: space[2],
        paddingVertical: space[1],
        borderRadius: radius.sm,
        backgroundColor: color.surface2,
    },
    grow: { flex: 1, minWidth: 0, gap: space[0.5], paddingVertical: space[2.5] },
    clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    choose: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: 44,
        marginHorizontal: size.gutter,
        paddingHorizontal: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    glyph: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.ink,
    },
    pressed: { opacity: 0.72 },
});
