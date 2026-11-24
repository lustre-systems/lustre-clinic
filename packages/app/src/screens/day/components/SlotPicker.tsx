import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Callout, Chip } from '../../../components/ui';
import { useT } from '../../../i18n';
import { border, color, radius, space, Text } from '../../../theme';
import type { Slot } from '../booking';
import type { RequestError } from '../data';
import { describeError } from '../errors';
import { clock12, relativeDayLabel } from '../time';
import { CalendarIcon } from './icons';

export type SlotPickerProps = {
    dateKey: string;
    days: readonly string[];
    daysLoading: boolean;
    onPickDate: (dateKey: string) => void;
    onPickFurtherDate: () => void;
    slotMinutes: number | null;
    onPickSlot: (minutes: number | null) => void;
    slots: readonly Slot[];
    loading: boolean;
    error: RequestError | null;
    onRetry: () => void;
    branchName: string | null;
    duration: React.ReactNode;
};

export function SlotPicker({
    dateKey,
    days,
    daysLoading,
    onPickDate,
    onPickFurtherDate,
    slotMinutes,
    onPickSlot,
    slots,
    loading,
    error,
    onRetry,
    branchName,
    duration,
}: SlotPickerProps) {
    const t = useT();
    const picked = slots.find((slot) => slot.minutes === slotMinutes) ?? null;
    const free = slots.filter((slot) => slot.state === 'free');

    const strip = useRef<ScrollView>(null);
    const stripEndsOnPick = days.length > 0 && days[days.length - 1] === dateKey;

    return (
        <View style={styles.step}>
            {duration}

            <View style={styles.section}>
                <Text variant="eyebrow" tone="muted">
                    {t('WHICH DAY')}
                </Text>
                {daysLoading ? (
                    <Text variant="subhead" tone="muted">
                        {t('Reading the fortnight…')}
                    </Text>
                ) : (
                    <>
                        <ScrollView
                            ref={strip}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.strip}
                            onContentSizeChange={() => {
                                if (stripEndsOnPick) strip.current?.scrollToEnd({ animated: false });
                            }}
                        >
                            {days.map((key) => (
                                <Chip
                                    key={key}
                                    label={relativeDayLabel(key)}
                                    selected={key === dateKey}
                                    onPress={() => {
                                        onPickDate(key);
                                        onPickSlot(null);
                                    }}
                                />
                            ))}
                            <Chip
                                label="Another date"
                                variant="new"
                                icon={<CalendarIcon size={15} stroke={color.accent} />}
                                onPress={onPickFurtherDate}
                                testID="booking-further-date"
                            />
                        </ScrollView>

                        {days.length === 0 ? (
                            <Text variant="subhead" tone="muted">
                                {branchName
                                    ? t(
                                          '{branch} has no day in the next fortnight with room for a visit this long. Try a shorter one, another branch, or a date further out.',
                                          { branch: branchName },
                                      )
                                    : t(
                                          'This branch has no day in the next fortnight with room for a visit this long. Try a shorter one, another branch, or a date further out.',
                                      )}
                            </Text>
                        ) : null}
                    </>
                )}
            </View>

            <View style={styles.section}>
                <View style={styles.timesHead}>
                    <Text variant="eyebrow" tone="muted">
                        {t('WHAT TIME')}
                    </Text>
                    {!loading && !error && slots.length > 0 ? (
                        <Text variant="caption" weight="medium" tone="muted">
                            {t('{count} free', { count: free.length })}
                        </Text>
                    ) : null}
                </View>

                {loading ? (
                    <Text variant="subhead" tone="muted">
                        {t('Reading that day…')}
                    </Text>
                ) : error ? (
                    <View style={styles.failure}>
                        <Text variant="subhead" tone="due">
                            {describeError(error, 'day').title}
                        </Text>
                        <Button label="Try again" variant="text" size="md" onPress={onRetry} />
                    </View>
                ) : free.length === 0 ? (
                    <Text variant="subhead" tone="muted">
                        {slots.length === 0
                            ? t('No times that day.')
                            : t('Every time that day has gone — pick another day above.')}
                    </Text>
                ) : (
                    <>
                        <View style={styles.grid}>
                            {free.map((slot) => (
                                <SlotChip
                                    key={slot.minutes}
                                    slot={slot}
                                    selected={slot.minutes === slotMinutes}
                                    onPress={() => onPickSlot(slot.minutes)}
                                />
                            ))}
                        </View>

                        {picked && picked.state !== 'free' ? (
                            <Callout
                                tone="warning"
                                title={
                                    picked.state === 'taken'
                                        ? 'That time is already booked'
                                        : 'That time has gone by'
                                }
                            >
                                Pick another one — a shorter visit may also fit.
                            </Callout>
                        ) : picked?.runsLate ? (
                            <Text variant="caption" tone="muted">
                                {t('That visit ends after the clinic closes.')}
                            </Text>
                        ) : null}
                    </>
                )}
            </View>
        </View>
    );
}

function SlotChip({ slot, selected, onPress }: { slot: Slot; selected: boolean; onPress: () => void }) {
    const { time, meridiem } = clock12(slot.minutes);

    return (
        <View style={styles.slot}>
            <Chip
                label={`${time} ${meridiem}`}
                selected={selected}
                disabled={slot.state !== 'free'}
                grow
                onPress={onPress}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    step: { gap: space[5] },
    section: { gap: space[2.5] },
    strip: { gap: space[2], paddingEnd: space[4] },
    timesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    slot: { width: '31.5%' },
    failure: {
        gap: space[2],
        padding: space[3],
        borderRadius: radius.lg,
        borderWidth: border.hair,
        borderColor: color.line,
    },
});
