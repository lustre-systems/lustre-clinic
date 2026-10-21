// Loading, failed, and data renderings for the money screens. The rule: an
// error replaces the data — a stale figure that failed to refresh must never
// sit above current-looking numbers, because acting on a balance that has
// moved is worse than a screen that says it is broken.
import type { ErrorCode } from '@lustre/shared';
import type { ReactNode } from 'react';
// biome-ignore lint/style/noRestrictedImports: drives the skeleton's `Animated.loop` imperatively, and stops it on cleanup
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Button, Card, PULSE, useReducedMotion } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import { errorMessage } from '../format';

export type SkeletonTone = 'light' | 'dark';

export function SkeletonBlock({
    width,
    height = 12,
    tone = 'light',
}: {
    width: number | `${number}%`;
    height?: number;
    tone?: SkeletonTone;
}) {
    const opacity = useRef(new Animated.Value(1)).current;
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        if (reducedMotion) return;

        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: PULSE.min,
                    duration: PULSE.duration,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, { toValue: 1, duration: PULSE.duration, useNativeDriver: true }),
            ]),
        );

        loop.start();
        return () => loop.stop();
    }, [opacity, reducedMotion]);

    return (
        <Animated.View
            style={[styles.block, tone === 'dark' && styles.blockOnDark, { width, height, opacity }]}
        />
    );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
    return (
        <Card>
            {Array.from({ length: rows }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
                <View key={index} style={styles.row}>
                    <View style={styles.rowText}>
                        <SkeletonBlock width="58%" height={14} />
                        <SkeletonBlock width="34%" height={11} />
                    </View>
                    <SkeletonBlock width={64} height={16} />
                </View>
            ))}
        </Card>
    );
}

export function SkeletonCard({ height = 132 }: { height?: number }) {
    return (
        <Card padded style={{ minHeight: height }}>
            <View style={styles.cardLines}>
                <SkeletonBlock width="40%" height={11} />
                <SkeletonBlock width="62%" height={28} />
                <SkeletonBlock width="80%" height={11} />
            </View>
        </Card>
    );
}

/**
 * The hero's own placeholder. A white `Card` under a card that is black flashes
 * the wrong surface for as long as the summary takes, then repaints — so this
 * borrows the hero's ground, radius and padding and tints its blocks with the
 * value that card already uses for the bar track behind the collected figure.
 */
export function SkeletonHeroCard({ height = 132 }: { height?: number }) {
    return (
        <View style={[styles.heroCard, { minHeight: height }]}>
            <View style={styles.heroLines}>
                <SkeletonBlock width="40%" height={11} tone="dark" />
                <SkeletonBlock width="62%" height={28} tone="dark" />
                <SkeletonBlock width="80%" height={11} tone="dark" />
            </View>
        </View>
    );
}

export type LoadStateProps = {
    isLoading: boolean;
    error: ErrorCode | null;
    onRetry: () => void;
    skeleton: ReactNode;
    children: ReactNode;
};

export function LoadState({ isLoading, error, onRetry, skeleton, children }: LoadStateProps) {
    const t = useT();
    if (error) {
        return (
            <Card padded style={styles.failure}>
                <Text variant="headline">{errorMessage(error)}</Text>
                <Text variant="subhead" tone="muted" style={styles.failureBody}>
                    {t('Nothing is shown rather than a figure that may have moved since.')}
                </Text>
                <Button label="Try again" onPress={onRetry} variant="secondary" size="md" />
            </Card>
        );
    }

    if (isLoading) return <>{skeleton}</>;
    return <>{children}</>;
}

const styles = StyleSheet.create({
    block: { backgroundColor: color.surface2, borderRadius: radius.sm },
    blockOnDark: { backgroundColor: color.onDarkTrack },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: size.row + space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
    },
    rowText: { flex: 1, gap: space[1.5] },
    cardLines: { gap: space[2.5] },
    // The hero's own geometry (`HeroCollectionCard`), minus the gradient and
    // the lift: a placeholder should hold the shape, not advertise itself.
    heroCard: {
        alignSelf: 'stretch',
        justifyContent: 'center',
        paddingVertical: space[6],
        paddingHorizontal: space[6],
        borderRadius: radius.xl4,
        backgroundColor: color.inkDeep,
    },
    heroLines: { gap: space[2.5] },
    failure: { alignItems: 'flex-start', gap: space[2] },
    failureBody: { marginBottom: space[1] },
});
