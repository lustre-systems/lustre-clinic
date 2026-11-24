import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import {
    BottomSheetBackdrop,
    BottomSheetModal,
    BottomSheetScrollView,
    BottomSheetView,
    useBottomSheetTimingConfigs,
} from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
// biome-ignore lint/style/noRestrictedImports: drives `BottomSheetModal`'s imperative present/dismiss ref, which is the animation running outside React. The hardware back is `useHardwareBack`'s.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { color, radius, size, space, Text } from '../../theme';
import { Chevron } from './Chevron';
import { duration } from './motion';
import { useHardwareBack } from './useHardwareBack';
import { useKeyboardHeight } from './useKeyboardHeight';

export type SheetProps = {
    visible: boolean;
    onClose: () => void;
    onClosed?: () => void;
    title?: string;
    subtitle?: string;
    onTitlePress?: () => void;
    titleAccessibilityLabel?: string;
    children?: ReactNode;
    footer?: ReactNode;
    maxHeightRatio?: number;
    dismissable?: boolean;
    dragFromBody?: boolean;
    scrollBody?: boolean;
    testID?: string;
};

export function Sheet({
    visible,
    onClose,
    onClosed,
    title,
    subtitle,
    onTitlePress,
    titleAccessibilityLabel,
    children,
    footer,
    maxHeightRatio = 0.86,
    dismissable = true,
    dragFromBody = true,
    scrollBody = true,
    testID,
}: SheetProps) {
    const sheet = useRef<BottomSheetModal>(null);
    const insets = useSafeAreaInsets();
    const window = useWindowDimensions();

    const timing = useBottomSheetTimingConfigs({ duration: duration.sheet });

    const keyboard = useKeyboardHeight();

    const floor = space[6] + Math.max(insets.bottom, keyboard);
    const baseFloor = space[6] + insets.bottom;
    const maxContent = window.height * maxHeightRatio - baseFloor;

    const closing = useRef(false);
    const asked = useRef(visible);
    const presented = useRef(false);
    const [down, setDown] = useState(false);

    useEffect(() => {
        asked.current = visible;

        if (visible) {
            closing.current = false;
            presented.current = true;
            if (down) setDown(false);
            sheet.current?.present();
            return;
        }

        if (!presented.current) return;

        if (closing.current) return;

        closing.current = true;
        sheet.current?.dismiss();
    }, [visible, down]);

    useHardwareBack(visible, () => {
        if (dismissable) onClose();
        return true;
    });

    const handleDismiss = useCallback(() => {
        closing.current = true;
        Keyboard.dismiss();
        if (asked.current) onClose();
        onClosed?.();
        setDown(true);
    }, [onClose, onClosed]);

    const renderBackdrop = useCallback(
        (props: BottomSheetBackdropProps) => (
            <BottomSheetBackdrop
                {...props}
                appearsOnIndex={0}
                disappearsOnIndex={-1}
                opacity={1}
                pressBehavior={dismissable ? 'close' : 'none'}
                style={[props.style, styles.backdrop]}
            />
        ),
        [dismissable],
    );

    const renderHandle = useCallback(
        () => (
            <View>
                <View style={styles.handleRow}>
                    <View style={styles.handle} />
                </View>

                {title ? (
                    <TitleBlock
                        title={title}
                        subtitle={subtitle}
                        onPress={onTitlePress}
                        accessibilityLabel={titleAccessibilityLabel}
                    />
                ) : null}
            </View>
        ),
        [title, subtitle, onTitlePress, titleAccessibilityLabel],
    );

    const body = (
        <>
            {children}
            {footer ? <View style={[styles.footer, { paddingBottom: floor }]}>{footer}</View> : null}
        </>
    );

    return (
        <BottomSheetModal
            ref={sheet}
            animationConfigs={timing}
            enableDynamicSizing
            maxDynamicContentSize={maxContent}
            topInset={insets.top}
            enablePanDownToClose={dismissable}
            enableContentPanningGesture={dragFromBody}
            activeOffsetY={[-10, 10]}
            stackBehavior="push"
            enableOverDrag={false}
            handleComponent={renderHandle}
            backdropComponent={renderBackdrop}
            backgroundStyle={styles.sheet}
            onDismiss={handleDismiss}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
        >
            {scrollBody ? (
                <BottomSheetScrollView
                    testID={testID}
                    contentContainerStyle={[styles.scrollContent, footer ? null : { paddingBottom: floor }]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                >
                    {body}
                </BottomSheetScrollView>
            ) : (
                <BottomSheetView
                    testID={testID}
                    style={[styles.scrollContent, footer ? null : { paddingBottom: floor }]}
                >
                    {body}
                </BottomSheetView>
            )}
        </BottomSheetModal>
    );
}

function TitleBlock({
    title,
    subtitle,
    onPress,
    accessibilityLabel,
}: {
    title: string;
    subtitle?: string;
    onPress?: () => void;
    accessibilityLabel?: string;
}) {
    const t = useT();
    const text = (
        <View style={styles.headerText}>
            <Text variant="title3">{t(title)}</Text>
            {subtitle ? (
                <Text variant="subhead" tone="muted">
                    {t(subtitle)}
                </Text>
            ) : null}
        </View>
    );

    if (!onPress) return <View style={styles.header}>{text}</View>;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(accessibilityLabel ?? title)}
            onPress={onPress}
            style={({ pressed }) => [styles.header, styles.headerButton, pressed && styles.headerPressed]}
        >
            {text}
            <Chevron direction="forward" tone="muted" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: { backgroundColor: color.scrim },
    sheet: {
        backgroundColor: color.surface,
        borderTopStartRadius: radius.sheet,
        borderTopEndRadius: radius.sheet,
    },
    handleRow: { alignItems: 'center', paddingTop: space[2.5], paddingBottom: space[1] },
    handle: { width: 38, height: 4, borderRadius: radius.full, backgroundColor: color.line },
    header: { paddingHorizontal: size.gutter, paddingTop: space[2], paddingBottom: space[3] },
    headerButton: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    headerText: { flex: 1, minWidth: 0, gap: space[1] },
    headerPressed: { backgroundColor: color.surface2 },
    scrollContent: { paddingHorizontal: size.gutter, gap: space[3] },
    footer: {
        marginHorizontal: -size.gutter,
        paddingHorizontal: size.gutter,
        paddingTop: space[3],
        borderTopWidth: 1,
        borderTopColor: color.hair,
        gap: space[2],
        backgroundColor: color.surface,
    },
});
