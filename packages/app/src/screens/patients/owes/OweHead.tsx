// "Who owe", the standing total, and the sort control. The total is the
// report's own `total` and is hidden while searching rather than recomputed
// over the filtered rows — a figure that shrank as you typed would read as the
// clinic being owed less than it is.
//
// The sort label is `ink2`, not `accent`. The design paints it in System B's
// green, which §7.1 resolves to the blue `accent`; a blue control is the only
// blue on a screen of green and orange and reads as a mistake, so the control
// stays neutral and the colour on this screen keeps meaning money.
import { useRef } from 'react';
import type { View as RNView } from 'react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import type { MenuAnchor } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import { MoneyValue } from '../../stats/MoneyValue';
import { DEBTOR_SORT_LABEL, type DebtorSort } from './debtors';
import { CaretDownIcon } from './icons';

const MENU_GAP = 8;

export type OweHeadProps = {
    total: number | null;
    sort: DebtorSort;
    onOpenSort: (anchor: MenuAnchor) => void;
    sortOpen: boolean;
};

export function OweHead({ total, sort, onOpenSort, sortOpen }: OweHeadProps) {
    const t = useT();
    const button = useRef<RNView>(null);

    // The menu is a Modal, so it wants window coordinates; the button's own
    // offset is relative to a row inside a scroller and says nothing about
    // where it currently is. Measured on press rather than on layout, because
    // scrolling moves it and nothing tells the row that it did.
    function open() {
        button.current?.measureInWindow((_x, y, _width, height) =>
            onOpenSort({ top: y + height + MENU_GAP, end: size.gutter }),
        );
    }

    return (
        <View style={styles.head}>
            <View style={styles.left}>
                <Text variant="eyebrow" script="sans" weight="bold" tone="muted">
                    {t('Who owe')}
                </Text>

                {total === null ? null : (
                    <View style={styles.pill}>
                        <MoneyValue
                            amount={total}
                            variant="footnote"
                            currencyVariant="footnote"
                            weight="bold"
                            tone="dueText"
                            compact
                            testID="owes-total"
                        />
                    </View>
                )}
            </View>

            <Pressable
                ref={button}
                accessibilityRole="button"
                accessibilityLabel={`${t('Sort patients')} — ${t(DEBTOR_SORT_LABEL[sort])}`}
                accessibilityState={{ expanded: sortOpen }}
                onPress={open}
                // The target is 44 without the row being 44: the design hangs
                // it off the heading's baseline, and a real 44px box here would
                // push the heading down and open a hole above the list.
                hitSlop={14}
                style={({ pressed }) => [styles.sort, pressed && styles.pressed]}
                testID="owes-sort"
            >
                <Text variant="callout" weight="semibold" tone="ink2">
                    {t(DEBTOR_SORT_LABEL[sort])}
                </Text>
                <CaretDownIcon />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[2],
        paddingHorizontal: size.gutter,
    },
    left: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
    pill: {
        paddingVertical: space[0.5],
        paddingHorizontal: space[2.5],
        borderRadius: radius.full,
        backgroundColor: color.dueSoft,
    },
    sort: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingStart: space[2] },
    pressed: { opacity: 0.6 },
});
