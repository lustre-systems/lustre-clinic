// biome-ignore lint/style/noRestrictedImports: clears the floor `setTimeout` on unmount — an external timer, and the only effect left here
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    RefreshControl,
    type RefreshControlProps,
    ScrollView,
    StyleSheet,
} from 'react-native';
import { color } from '../../theme';

const MIN_VISIBLE_MS = 600;

export type RefreshControlElement = ReactElement<RefreshControlProps>;

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

export type PullScrollProps = {
    onScroll: (event: ScrollEvent) => void;
    onScrollBeginDrag: (event: ScrollEvent) => void;
    onScrollEndDrag: (event: ScrollEvent) => void;
    scrollEventThrottle: number;
};

export type PullToRefresh = {
    refreshControl: RefreshControlElement;
    scrollProps: PullScrollProps;
};

export function usePullToRefresh(refresh: () => void, busy: boolean): PullToRefresh {
    const [refreshing, setRefreshing] = useState(false);
    const [floor, setFloor] = useState(false);
    const [enabled, setEnabled] = useState(true);

    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;

    const atTop = useRef(true);
    const dragging = useRef(false);

    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        setFloor(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            setFloor(false);
        }, MIN_VISIBLE_MS);

        refreshRef.current();
    }, []);

    const onScroll = useCallback((event: ScrollEvent) => {
        atTop.current = event.nativeEvent.contentOffset.y <= 0;
        if (!dragging.current) setEnabled(atTop.current);
    }, []);

    const onScrollBeginDrag = useCallback((event: ScrollEvent) => {
        dragging.current = true;
        setEnabled(event.nativeEvent.contentOffset.y <= 0);
    }, []);

    const onScrollEndDrag = useCallback(() => {
        dragging.current = false;
        setEnabled(atTop.current);
    }, []);

    if (refreshing && !busy && !floor) setRefreshing(false);

    return {
        refreshControl: (
            <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                enabled={enabled}
                tintColor={color.ink}
                colors={[color.ink]}
                progressBackgroundColor={color.surface}
            />
        ),
        scrollProps: { onScroll, onScrollBeginDrag, onScrollEndDrag, scrollEventThrottle: 16 },
    };
}

export type RefreshViewProps = {
    pull?: PullToRefresh;
    children: ReactNode;
    testID?: string;
};

export function RefreshView({ pull, children, testID }: RefreshViewProps) {
    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            refreshControl={pull?.refreshControl}
            {...pull?.scrollProps}
            showsVerticalScrollIndicator={false}
            testID={testID}
        >
            {children}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: { flex: 1 },
    content: { flexGrow: 1 },
});
