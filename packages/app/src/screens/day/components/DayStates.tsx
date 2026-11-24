import { StyleSheet, View } from 'react-native';
import { Button, EmptyState } from '../../../components/ui';
import { useT } from '../../../i18n';
import { color, radius, size, space, Text } from '../../../theme';
import type { RequestError } from '../data';
import { emptyDay } from '../empty';
import { describeError } from '../errors';
import { CalendarIcon } from './icons';

export function DaySkeleton() {
    return (
        <View style={styles.skeleton} accessibilityLabel="Loading the day" accessible>
            {[64, 96, 48, 72, 56].map((height, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative list
                <View key={index} style={[styles.bar, { height }]} />
            ))}
        </View>
    );
}

export type DayErrorProps = {
    error: RequestError;
    onRetry: () => void;
};

export function DayError({ error, onRetry }: DayErrorProps) {
    const { title, body } = describeError(error, 'day');

    return (
        <View style={styles.centred}>
            <View style={styles.panel}>
                <Text variant="headline" weight="semibold" style={styles.centredText}>
                    {title}
                </Text>
                {body ? (
                    <Text variant="body" tone="muted" style={styles.centredText}>
                        {body}
                    </Text>
                ) : null}
                <Button label="Try again" variant="secondary" onPress={onRetry} style={styles.action} />
            </View>
        </View>
    );
}

export type DayEmptyProps = {
    past: boolean;
    onBook?: () => void;
    elsewhere?: { name: string; count: number; onGo: () => void };
};

export function DayEmpty({ past, onBook, elsewhere }: DayEmptyProps) {
    const t = useT();
    const state = emptyDay(past, onBook !== undefined);

    return (
        <View style={styles.centred}>
            <EmptyState
                weight="ring"
                icon={state.glyph === 'calendar' ? <CalendarIcon size={22} stroke={color.ink2} /> : null}
                title={state.title}
                body={state.body}
                actionLabel={state.actionLabel}
                onAction={state.actionLabel ? onBook : undefined}
            />

            {elsewhere ? (
                <View style={styles.elsewhere}>
                    <Text variant="footnote" tone="muted" style={styles.centredText}>
                        {t(
                            elsewhere.count === 1
                                ? '{count} appointment that day, in {name}.'
                                : '{count} appointments that day, in {name}.',
                            { count: elsewhere.count, name: elsewhere.name },
                        )}
                    </Text>
                    <Button
                        label={t('Open {name}', { name: elsewhere.name })}
                        variant="text"
                        size="md"
                        onPress={elsewhere.onGo}
                        style={styles.action}
                    />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    skeleton: { padding: size.gutter, gap: space[3] },
    bar: { backgroundColor: color.surface2, borderRadius: radius.md },
    centred: { flex: 1, justifyContent: 'center', padding: size.gutter },
    panel: { alignItems: 'center', gap: space[3] },
    centredText: { textAlign: 'center' },
    elsewhere: { marginTop: space[5], alignItems: 'center', gap: space[1] },
    action: { alignSelf: 'center' },
});
