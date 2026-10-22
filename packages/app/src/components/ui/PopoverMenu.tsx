/**
 * The overflow menu — anchored under the trailing icon button, scaling .94 → 1.
 * The anchor is passed in rather than measured: the trigger is a top-bar button
 * at a fixed inset on every screen that has one, and measuring it would make the
 * menu depend on layout timing for no gain. Exactly one inline edge must be set —
 * start or end, never both — or the surface stretches across the window instead
 * of sitting under its trigger.
 */
import type { ReactNode } from 'react';
// biome-ignore lint/style/noRestrictedImports: runs the open/close `Animated.timing` and unmounts on its completion callback, so the menu finishes leaving before it goes
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, shadow, size, space, Text } from '../../theme';
import { duration, easing } from './motion';
import { Scrim } from './Scrim';
import { useReducedMotion } from './useReducedMotion';

export type MenuAnchor = {
    top: number;
    end?: number;
    start?: number;
    /** The trigger's own width, for a menu that drops from a field. */
    width?: number;
};

export type MenuItem = {
    key: string;
    label: string;
    icon?: ReactNode;
    onPress: () => void;
    danger?: boolean;
    disabled?: boolean;
};

export type PopoverMenuProps = {
    visible: boolean;
    onClose: () => void;
    items: readonly MenuItem[];
    anchor?: MenuAnchor;
    accessibilityLabel?: string;
    testID?: string;
};

export function PopoverMenu({
    visible,
    onClose,
    items,
    anchor,
    accessibilityLabel,
    testID,
}: PopoverMenuProps) {
    const t = useT();

    return (
        <MenuSurface
            visible={visible}
            onClose={onClose}
            anchor={anchor}
            accessibilityLabel={accessibilityLabel}
            testID={testID}
        >
            {items.map((item, index) => (
                <View key={item.key}>
                    {item.danger && index > 0 ? <View style={styles.divider} /> : null}
                    <Pressable
                        accessibilityRole="menuitem"
                        accessibilityState={{ disabled: item.disabled }}
                        disabled={item.disabled}
                        onPress={() => {
                            onClose();
                            item.onPress();
                        }}
                        style={({ pressed }) => [
                            styles.item,
                            pressed && styles.pressed,
                            item.disabled && styles.disabled,
                        ]}
                    >
                        {item.icon}
                        <Text variant="body" tone={item.danger ? 'danger' : 'ink'}>
                            {t(item.label)}
                        </Text>
                    </Pressable>
                </View>
            ))}
        </MenuSurface>
    );
}

/**
 * `drop` is a field's menu: it unfolds from the field's edge rather than scaling
 * from its middle, and leaves the page undimmed, since it is part of the form
 * rather than over it.
 */
export type MenuMotion = 'popover' | 'drop';

export type MenuSurfaceProps = {
    visible: boolean;
    onClose: () => void;
    anchor?: MenuAnchor;
    motion?: MenuMotion;
    children: ReactNode;
    accessibilityLabel?: string;
    testID?: string;
};

export function MenuSurface({
    visible,
    onClose,
    anchor,
    motion = 'popover',
    children,
    accessibilityLabel,
    testID,
}: MenuSurfaceProps) {
    const t = useT();
    const progress = useRef(new Animated.Value(0)).current;
    const [mounted, setMounted] = useState(visible);
    const reducedMotion = useReducedMotion();

    // Callers clear the anchor in the same update that closes the menu, and the
    // surface is still on screen for its exit. Without the last anchor held, it
    // fell back to the default corner and jumped to the top right as it faded.
    const lastAnchor = useRef(anchor);
    if (anchor) lastAnchor.current = anchor;
    const at = anchor ?? (visible ? undefined : lastAnchor.current);

    useEffect(() => {
        if (visible) setMounted(true);
        const drop = motion === 'drop';
        const animation = Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: reducedMotion ? 0 : drop && visible ? duration.drop : duration.popover,
            easing: drop && visible ? easing.promote : easing.standard,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (finished && !visible) setMounted(false);
        });
        return () => animation.stop();
    }, [visible, progress, reducedMotion, motion]);

    if (!mounted) return null;

    const top = at?.top ?? space[12];
    const inline = at?.start !== undefined ? { start: at.start } : { end: at?.end ?? size.gutter };
    const width = at?.width !== undefined ? { width: at.width } : null;
    const drop = motion === 'drop';
    const shape = drop
        ? {
              opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
              transformOrigin: 'top' as const,
              transform: [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-space[2], 0] }) },
                  { scaleY: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
              ],
          }
        : {
              opacity: progress,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
          };

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose} testID={testID}>
            {drop ? (
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('Close')}
                />
            ) : (
                <Scrim opacity={progress} onPress={onClose} />
            )}
            <Animated.View
                accessibilityRole="menu"
                accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
                // Every item closes the menu before it acts, and the menu is
                // still on screen for the whole exit — so without this a second
                // tap lands on a row that has already run, and runs it again.
                // The surface goes dead the moment it is leaving.
                pointerEvents={visible ? 'auto' : 'none'}
                style={[styles.surface, { top, ...inline }, width, shape]}
            >
                {drop ? (
                    // The rows come in behind the surface, so it reads as
                    // unfolding rather than as a squashed list stretching.
                    <Animated.View
                        style={{
                            opacity: progress.interpolate({
                                inputRange: [0, 0.5, 1],
                                outputRange: [0, 0, 1],
                            }),
                        }}
                    >
                        {children}
                    </Animated.View>
                ) : (
                    children
                )}
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    surface: {
        position: 'absolute',
        minWidth: 200,
        paddingVertical: space[1],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
        boxShadow: shadow.card,
        overflow: 'hidden',
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2.5],
        minHeight: size.row,
        paddingHorizontal: space[4],
    },
    divider: { height: 1, backgroundColor: color.hair, marginVertical: space[1] },
    pressed: { backgroundColor: color.surface2 },
    disabled: { opacity: 0.32 },
});
