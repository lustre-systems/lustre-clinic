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
                pointerEvents={visible ? 'auto' : 'none'}
                style={[styles.surface, { top, ...inline }, width, shape]}
            >
                {drop ? (
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
