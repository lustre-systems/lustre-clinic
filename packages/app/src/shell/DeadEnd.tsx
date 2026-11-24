import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { color, radius, space, Text } from '../theme';

export function DeadEnd({
    glyph,
    title,
    body,
    children,
    after,
}: {
    glyph: ReactNode;
    title: string;
    body: string;
    children: ReactNode;
    after?: ReactNode;
}) {
    return (
        <ScrollView
            style={styles.root}
            contentContainerStyle={[styles.content, after ? styles.top : null]}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.card}>
                <View style={styles.glyph}>{glyph}</View>
                <Text variant="title3">{title}</Text>
                <Text variant="subhead" tone="muted" style={styles.body}>
                    {body}
                </Text>
                {children}
            </View>
            {after}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.canvas },
    content: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[5],
        padding: space[5],
    },
    top: { justifyContent: 'flex-start' },
    card: {
        alignSelf: 'stretch',
        alignItems: 'center',
        gap: space[2],
        paddingVertical: space[8],
        paddingHorizontal: space[5],
        borderRadius: radius.xl2,
        backgroundColor: color.surface,
    },
    glyph: {
        width: 52,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: space[1],
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: color.line,
    },
    body: { textAlign: 'center' },
});
