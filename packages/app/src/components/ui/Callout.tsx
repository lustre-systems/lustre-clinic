import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import type { TextTone } from '../../theme';
import { color, radius, space, Text } from '../../theme';

export type CalloutTone = 'info' | 'warning' | 'reassurance' | 'note';

export type CalloutProps = {
    tone?: CalloutTone;
    title?: string;
    children: ReactNode;
    icon?: ReactNode;
};

const GLYPH: Record<CalloutTone, string> = {
    info: 'ⓘ',
    warning: '⚠',
    reassurance: '✓',
    note: '🔒',
};

const GROUND: Record<CalloutTone, string> = {
    info: color.canvas,
    warning: color.dueSoft,
    reassurance: color.successSoft,
    note: color.canvas,
};

const EDGE: Record<CalloutTone, string> = {
    info: color.line,
    warning: color.due,
    reassurance: color.successSoft,
    note: color.line,
};

const TEXT: Record<CalloutTone, TextTone> = {
    info: 'ink2',
    warning: 'due',
    reassurance: 'success',
    note: 'muted',
};

export function Callout({ tone = 'info', title, children, icon }: CalloutProps) {
    const t = useT();
    return (
        <View
            style={[
                styles.callout,
                { backgroundColor: GROUND[tone], borderColor: EDGE[tone] },
                tone === 'note' && styles.note,
            ]}
        >
            <View style={styles.glyph}>
                {icon ?? (
                    <Text variant="footnote" tone={TEXT[tone]}>
                        {GLYPH[tone]}
                    </Text>
                )}
            </View>

            <View style={styles.body}>
                {title ? (
                    <Text variant="subhead" weight="semibold" tone={TEXT[tone]}>
                        {t(title)}
                    </Text>
                ) : null}
                {typeof children === 'string' ? (
                    <Text variant="subhead" tone={tone === 'info' || tone === 'note' ? 'muted' : TEXT[tone]}>
                        {t(children)}
                    </Text>
                ) : (
                    children
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    callout: {
        flexDirection: 'row',
        alignSelf: 'stretch',
        gap: space[2.5],
        padding: space[3],
        borderRadius: radius.md,
        borderWidth: 1,
    },
    note: { borderStyle: 'dashed' },
    glyph: { paddingTop: space[0.5] },
    body: { flex: 1, gap: space[0.5] },
});
