import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MoneyValue, phoneText, ToothGroupCard } from '../../components/domain';
import { Button, Callout, Chevron, StepView, useKeyboardHeight } from '../../components/ui';
import { useT } from '../../i18n';
import { border, color, radius, size, space, Text } from '../../theme';
import { CalendarIcon, PatientIcon } from '../day/components/icons';
import { type PlanCopy, ProcedurePlan } from '../day/components/ProcedurePlan';
import { Steps, SummaryRow } from '../day/components/Steps';
import { api as dayApi, useGeneralClinic, useLocalQuery } from '../day/data';
import {
    chargeableTotal,
    checkupIsWaived,
    groupByTooth,
    type PlannedProcedure,
    toothPosition,
} from '../day/procedures';
import { dayOfMonth, monthShort, relativeDayLabel, todayKey } from '../day/time';
import { MonthGrid } from './components/MonthGrid';
import { formatMoney } from './components/money';
import { patientsApi } from './data/api';
import { errorText } from './data/errors';
import { useMutation, useQuery } from './data/hooks';

export type OldVisitScreenProps = {
    patientId: string;
    onBack: () => void;
    onSavingChange?: (saving: boolean) => void;
    onRecorded: (message: string) => void;
};

type Step = 'what' | 'day' | 'confirm';

const STEPS: { key: Step; label: string }[] = [
    { key: 'what', label: 'Procedures' },
    { key: 'day', label: 'Day' },
    { key: 'confirm', label: 'Confirm' },
];

const PLAN_COPY: PlanCopy = {
    heading: 'WHAT WAS DONE',
    emptyHint: 'At least one',
    emptyTitle: 'Nothing added yet',
    emptyBody: 'It is charged like any other visit.',
    total: 'Total',
};

const BAR_HEIGHT = space[3] + size.button + space[4];

export function OldVisitScreen({ patientId, onBack, onSavingChange, onRecorded }: OldVisitScreenProps) {
    const t = useT();

    const [index, setIndex] = useState(0);
    const [plan, setPlan] = useState<PlannedProcedure[]>([]);
    const [performedOn, setPerformedOn] = useState<string | null>(null);
    const [month, setMonth] = useState(todayKey());
    const [dockHeight, setDockHeight] = useState(BAR_HEIGHT);
    const keyboard = useKeyboardHeight();

    const record = useQuery(['byId', patientId], () => patientsApi.byId(patientId));
    const save = useMutation(patientsApi.addOldVisit);
    const catalogue = useLocalQuery('procedure-tree', dayApi.procedureTree);
    const general = useGeneralClinic();

    const patient = record.data?.patient;
    const name = patient?.name ?? '';
    const step = STEPS[index]?.key ?? 'confirm';

    const checkups = new Set(
        (catalogue.data ?? [])
            .flatMap((root) => [root, ...root.children])
            .filter((row) => row.isCheckup)
            .map((row) => row.id),
    );
    const chargeable = plan.map((line) => ({
        unitPrice: line.price,
        quantity: 1,
        isCheckup: checkups.has(line.procedureId),
    }));
    const total = chargeableTotal(chargeable, checkupIsWaived(chargeable));
    const whatAnswered = plan.length > 0;
    const ready = performedOn !== null && whatAnswered;

    const last = step === 'confirm';
    const stepReady = step === 'what' ? whatAnswered : step === 'day' ? performedOn !== null : ready;

    async function submit() {
        if (!ready || performedOn === null) return;

        onSavingChange?.(true);
        const added = await save.mutate({
            patientId,
            performedOn,
            procedures: plan.map((line) => ({
                procedureId: line.procedureId,
                quantity: 1,
                ...(line.tooth === null ? {} : { tooth: line.tooth }),
                unitPrice: line.price,
            })),
        });
        onSavingChange?.(false);
        if (!added) return;

        onRecorded(t('Visit recorded — {amount} paid', { amount: formatMoney(added.chargedTotal) }));
    }

    return (
        <View style={styles.screen} testID="old-visit-screen">
            <View style={styles.topbar}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={index === 0 ? 'Back to the record' : 'Back a step'}
                    disabled={save.pending}
                    onPress={() => {
                        if (index === 0) {
                            onBack();
                            return;
                        }
                        save.reset();
                        setIndex(index - 1);
                    }}
                    style={({ pressed }) => [styles.back, pressed && styles.pressed]}
                >
                    <Chevron direction="back" size={10} tone="ink" />
                </Pressable>
                <Text variant="eyebrow" tone="muted">
                    {t('OLD VISIT')}
                </Text>
            </View>

            <View style={styles.identity}>
                <View style={styles.tile}>
                    {performedOn ? (
                        <>
                            <Text variant="title2" script="sans" weight="bold" tone="inverse">
                                {dayOfMonth(performedOn)}
                            </Text>
                            <Text variant="eyebrow" tone="inverse" style={styles.tileMonth}>
                                {monthShort(performedOn).toUpperCase()}
                            </Text>
                        </>
                    ) : (
                        <Text variant="title2" script="sans" weight="bold" tone="inverse">
                            —
                        </Text>
                    )}
                </View>

                <View style={styles.who}>
                    <Text variant="title2" weight="bold" numberOfLines={1}>
                        {name}
                    </Text>
                    <Text variant="footnote" tone="muted" numberOfLines={1}>
                        {patient?.phone ? phoneText(patient.phone) : t('No phone on file')}
                    </Text>
                    <View style={styles.chip}>
                        <Text variant="footnote" weight="bold" tone="ink2">
                            {performedOn ? relativeDayLabel(performedOn) : t('No day yet')}
                        </Text>
                    </View>
                </View>
            </View>

            <Steps index={index} steps={STEPS} testID="old-visit-steps" />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.body, { paddingBottom: dockHeight + space[5] }]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
            >
                <StepView index={index} style={styles.stepBody}>
                    {step === 'what' ? (
                        <ProcedurePlan
                            value={plan}
                            onChange={setPlan}
                            categories={catalogue.data ?? []}
                            loading={catalogue.status === 'loading'}
                            error={catalogue.status === 'error' ? catalogue.error : null}
                            onRetry={catalogue.refetch}
                            general={general}
                            copy={PLAN_COPY}
                        />
                    ) : step === 'day' ? (
                        <View style={styles.section}>
                            <Text variant="eyebrow" tone="muted">
                                {t('WHICH DAY')}
                            </Text>
                            <MonthGrid
                                month={month}
                                onMonth={setMonth}
                                selected={performedOn}
                                onPick={(day) => {
                                    setPerformedOn(day);
                                    save.reset();
                                }}
                            />
                            <Text variant="caption" tone="muted">
                                {t('Pick the day it happened.')}
                            </Text>
                        </View>
                    ) : (
                        <>
                            <View style={styles.card}>
                                <SummaryRow
                                    label="Day"
                                    value={performedOn ? relativeDayLabel(performedOn) : '—'}
                                    icon={<CalendarIcon size={17} />}
                                    lead
                                />
                                <SummaryRow label="Patient" value={name} icon={<PatientIcon />} />
                            </View>

                            <View style={styles.section}>
                                <View style={styles.head}>
                                    <Text variant="eyebrow" tone="muted">
                                        {t('WHAT WAS DONE')}
                                    </Text>
                                    <Text variant="caption" weight="medium" tone="muted">
                                        {plan.length === 1
                                            ? t('1 procedure')
                                            : t('{count} procedures', { count: plan.length })}
                                    </Text>
                                </View>

                                <View style={styles.groups}>
                                    {groupByTooth(plan).map((group) => (
                                        <ToothGroupCard
                                            key={group.tooth ?? 'none'}
                                            tooth={group.tooth}
                                            position={toothPosition(group.tooth, general)}
                                            subtotal={
                                                <MoneyValue
                                                    piastres={group.subtotal}
                                                    variant="headline"
                                                    weight="bold"
                                                />
                                            }
                                            lines={group.items.map((item) => ({
                                                id: item.id,
                                                name: item.name,
                                                detail: item.variant,
                                                money: (
                                                    <MoneyValue
                                                        piastres={item.price}
                                                        variant="body"
                                                        weight="bold"
                                                    />
                                                ),
                                            }))}
                                        />
                                    ))}
                                </View>

                                <View style={styles.totalBand}>
                                    <Text variant="subhead" tone="muted">
                                        {t('Paid on the day')}
                                    </Text>
                                    <Text variant="title3" weight="bold">
                                        {formatMoney(total)}
                                    </Text>
                                </View>
                                <Text variant="caption" tone="muted">
                                    {t(
                                        'Recorded as paid in cash. If they still owe some of it, open the visit from the record and correct what was paid.',
                                    )}
                                </Text>
                            </View>
                        </>
                    )}
                </StepView>
            </ScrollView>

            <View
                style={[styles.dock, { paddingBottom: keyboard }]}
                pointerEvents="box-none"
                onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
            >
                {save.error ? (
                    <View style={styles.notice}>
                        <Callout tone="warning" title="Not recorded">
                            {errorText(save.error)}
                        </Callout>
                    </View>
                ) : null}

                <View style={styles.bar}>
                    <Button
                        label={last ? t('Record this visit') : 'Next'}
                        block
                        loading={save.pending}
                        disabled={!stepReady || save.pending}
                        onPress={() => {
                            if (last) {
                                void submit();
                                return;
                            }
                            save.reset();
                            setIndex(index + 1);
                        }}
                        testID="old-visit-next"
                    />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },

    topbar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        paddingHorizontal: space[3],
        paddingTop: space[2],
        paddingBottom: space[1],
    },
    back: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },
    pressed: { opacity: 0.6 },

    identity: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3.5],
        paddingHorizontal: size.gutter,
        paddingTop: space[2],
        paddingBottom: space[4],
    },
    tile: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.xl2,
        backgroundColor: color.ink,
    },
    tileMonth: { opacity: 0.62 },
    who: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
    chip: {
        paddingHorizontal: space[2.5],
        paddingVertical: space[1],
        borderRadius: radius.full,
        backgroundColor: color.surface2,
    },

    scroll: { flex: 1 },
    body: { paddingHorizontal: size.gutter },
    stepBody: { gap: space[5] },
    section: { gap: space[2.5] },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },

    card: {
        gap: space[3],
        padding: space[4],
        borderRadius: radius.xl,
        borderWidth: border.hair,
        borderColor: color.line,
        backgroundColor: color.surface,
    },

    groups: { gap: space[3] },
    totalBand: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: space[3.5],
        borderRadius: radius.lg,
        backgroundColor: color.surface2,
    },

    notice: { paddingHorizontal: size.gutter, paddingBottom: space[2] },
    dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
    bar: {
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        paddingBottom: space[4],
        backgroundColor: color.transparent,
    },
});
