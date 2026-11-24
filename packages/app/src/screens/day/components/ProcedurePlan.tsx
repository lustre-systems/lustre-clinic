import type { Tooth } from '@lustre/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { MoneyValue, ToothGroupCard } from '../../../components/domain';
import { poundsToPiastres, toPounds } from '../../../components/domain/money';
import { duration } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, font, radius, size, space, Text, type } from '../../../theme';
import type { ProcedureCategory, RequestError } from '../data';
import {
    asksTooth,
    groupByTooth,
    type PlannedProcedure,
    repriced,
    toothPosition,
    totalOf,
} from '../procedures';
import { PlusIcon, XIcon } from './icons';
import { type PickedProcedure, ProcedureSheet } from './ProcedureSheet';
import { ToothSheet } from './ToothSheet';

export type ProcedurePlanProps = {
    value: readonly PlannedProcedure[];
    onChange: (next: PlannedProcedure[]) => void;
    categories: readonly ProcedureCategory[];
    loading: boolean;
    error: RequestError | null;
    onRetry: () => void;
    general?: boolean;
    copy?: PlanCopy;
};

export type PlanCopy = {
    heading: string;
    emptyHint: string;
    emptyTitle: string;
    emptyBody: string;
    emptyBodyNoTooth?: string;
    total: string;
};

const BOOKING_COPY: PlanCopy = {
    heading: 'WHAT IS PLANNED',
    emptyHint: 'Optional',
    emptyTitle: 'Nothing planned yet',
    emptyBody: 'Add what the visit is for — a tooth, then the procedure.',
    emptyBodyNoTooth: 'Add what the visit is for.',
    total: 'Estimated total',
};

type Asking =
    | null
    | { step: 'tooth' }
    | { step: 'procedure'; tooth: Tooth | null }
    | { step: 'toothFor'; picked: PickedProcedure };

export function ProcedurePlan({
    value,
    onChange,
    categories,
    loading,
    error,
    onRetry,
    general = false,
    copy = BOOKING_COPY,
}: ProcedurePlanProps) {
    const t = useT();
    const [asking, setAsking] = useState<Asking>(null);
    const [collapsed, setCollapsed] = useState<readonly string[]>([]);

    const groups = groupByTooth(value);
    const total = totalOf(value);
    const toothFirst = asksTooth(loading ? undefined : categories, general);

    function startAdding() {
        setAsking(toothFirst ? { step: 'tooth' } : { step: 'procedure', tooth: null });
    }

    function askProcedure(tooth: Tooth | null, afterSheet: boolean) {
        if (!afterSheet) {
            setAsking({ step: 'procedure', tooth });
            return;
        }
        setAsking(null);
        setTimeout(() => setAsking({ step: 'procedure', tooth }), duration.sheet);
    }

    function pick(tooth: Tooth | null, picked: PickedProcedure) {
        if (tooth === null && picked.needsTooth) {
            setAsking(null);
            setTimeout(() => setAsking({ step: 'toothFor', picked }), duration.sheet);
            return;
        }
        add(tooth, picked);
    }

    function add(tooth: Tooth | null, picked: PickedProcedure) {
        onChange([
            ...value,
            {
                id: `plan-${Date.now()}-${value.length}`,
                procedureId: picked.procedureId,
                name: picked.name,
                variant: picked.variant,
                tooth,
                price: picked.price,
                defaultPrice: picked.price,
                quoted: false,
            },
        ]);
        setAsking(null);
    }

    function remove(id: string) {
        onChange(value.filter((row) => row.id !== id));
    }

    function reprice(id: string, entry: string) {
        const price = poundsToPiastres(entry);
        onChange(value.map((row) => (row.id === id ? repriced(row, price) : row)));
    }

    function toggle(key: string) {
        setCollapsed((current) =>
            current.includes(key) ? current.filter((row) => row !== key) : [...current, key],
        );
    }

    return (
        <View style={styles.plan}>
            <View style={styles.head}>
                <Text variant="eyebrow" tone="muted">
                    {t(copy.heading)}
                </Text>
                <Text variant="caption" tone="muted">
                    {value.length === 0
                        ? t(copy.emptyHint)
                        : value.length === 1
                          ? t('1 procedure')
                          : t('{count} procedures', { count: value.length })}
                </Text>
            </View>

            {value.length === 0 ? (
                <Pressable
                    accessibilityRole="button"
                    onPress={startAdding}
                    style={({ pressed }) => [styles.empty, pressed && styles.pressed]}
                    testID="plan-empty-add"
                >
                    <View style={styles.ring}>
                        <PlusIcon size={20} stroke={color.ink} />
                    </View>
                    <Text variant="headline">{t(copy.emptyTitle)}</Text>
                    <Text variant="subhead" tone="muted" style={styles.emptyBody}>
                        {t(toothFirst ? copy.emptyBody : (copy.emptyBodyNoTooth ?? copy.emptyBody))}
                    </Text>
                </Pressable>
            ) : (
                <View style={styles.groups}>
                    {groups.map((group) => {
                        const key = group.tooth ?? 'none';
                        const open = !collapsed.includes(key);

                        return (
                            <ToothGroupCard
                                key={key}
                                tooth={group.tooth}
                                position={toothPosition(group.tooth, general)}
                                expanded={open}
                                onToggle={() => toggle(key)}
                                subtotal={
                                    <MoneyValue
                                        piastres={group.subtotal}
                                        variant="subhead"
                                        weight="semibold"
                                    />
                                }
                                lines={group.items.map((item) => ({
                                    id: item.id,
                                    name: item.name,
                                    detail: item.variant,
                                    money: (
                                        <>
                                            <Text variant="caption" tone="muted">
                                                {t('EGP')}
                                            </Text>
                                            <TextInput
                                                value={String(toPounds(item.price))}
                                                onChangeText={(entry) => reprice(item.id, entry)}
                                                keyboardType="number-pad"
                                                selectTextOnFocus
                                                accessibilityLabel={t('Price for {name}', {
                                                    name: item.name,
                                                })}
                                                style={styles.price}
                                            />
                                        </>
                                    ),
                                    trailing: (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={t('Remove {name}', { name: item.name })}
                                            hitSlop={8}
                                            onPress={() => remove(item.id)}
                                            style={({ pressed }) => [
                                                styles.kill,
                                                pressed && styles.killPressed,
                                            ]}
                                        >
                                            <XIcon size={14} stroke={color.muted} />
                                        </Pressable>
                                    ),
                                }))}
                                footer={
                                    group.tooth ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            onPress={() => askProcedure(group.tooth, false)}
                                            style={({ pressed }) => [
                                                styles.groupAdd,
                                                pressed && styles.pressed,
                                            ]}
                                        >
                                            <PlusIcon size={13} stroke={color.ink2} />
                                            <Text variant="caption" weight="semibold" tone="ink2">
                                                {t('Add to {tooth}', { tooth: group.tooth })}
                                            </Text>
                                        </Pressable>
                                    ) : null
                                }
                            />
                        );
                    })}

                    <Pressable
                        accessibilityRole="button"
                        onPress={startAdding}
                        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                        testID="plan-add"
                    >
                        <View style={styles.addGlyph}>
                            <PlusIcon size={13} stroke={color.inverse} />
                        </View>
                        <Text variant="subhead" weight="semibold" tone="ink2">
                            {t('Add procedure')}
                        </Text>
                    </Pressable>

                    <View style={styles.total}>
                        <Text variant="subhead" tone="muted">
                            {t(copy.total)}
                        </Text>
                        <MoneyValue piastres={total} variant="title3" weight="semibold" />
                    </View>
                </View>
            )}

            <ToothSheet
                visible={asking?.step === 'tooth' || asking?.step === 'toothFor'}
                required={
                    asking?.step === 'toothFor' ? (asking.picked.variant ?? asking.picked.name) : undefined
                }
                onClose={() => setAsking(null)}
                onPick={(tooth) => {
                    if (asking?.step === 'toothFor') {
                        add(tooth, asking.picked);
                        return;
                    }
                    askProcedure(tooth, true);
                }}
            />

            <ProcedureSheet
                visible={asking?.step === 'procedure'}
                onClose={() => setAsking(null)}
                onPick={(picked) => pick(asking?.step === 'procedure' ? asking.tooth : null, picked)}
                categories={categories}
                loading={loading}
                error={error}
                onRetry={onRetry}
                tooth={asking?.step === 'procedure' ? asking.tooth : null}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    plan: { gap: space[2.5] },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    grow: { flex: 1, minWidth: 0 },

    empty: {
        alignItems: 'center',
        gap: space[1.5],
        paddingVertical: space[7],
        paddingHorizontal: space[5],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    ring: {
        width: 52,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.surface2,
        marginBottom: space[1],
    },
    emptyBody: { textAlign: 'center' },

    groups: { gap: space[3] },
    price: {
        minWidth: 62,
        paddingVertical: space[1],
        textAlign: 'right',
        ...type.body,
        fontFamily: font.mono.medium,
        color: color.ink,
    },
    kill: {
        width: 26,
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
    },
    killPressed: { backgroundColor: color.dangerSoft },

    groupAdd: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        minHeight: 42,
        paddingHorizontal: space[3.5],
        borderTopWidth: border.hair,
        borderTopColor: color.line,
        borderStyle: 'dashed',
    },

    add: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: size.row,
        paddingHorizontal: space[3.5],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderStyle: 'dashed',
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    addGlyph: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: color.ink,
    },

    total: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: space[3.5],
        borderRadius: radius.lg,
        backgroundColor: color.canvas,
    },
    pressed: { opacity: 0.72 },
});
