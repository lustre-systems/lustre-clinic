import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import type { TextTone } from '../../theme';
import { color, size, space, Text } from '../../theme';
import { Dot } from './Dot';

export type BannerTone = 'offline' | 'warning' | 'info' | 'success';

export type BannerProps = {
    tone?: BannerTone;
    message: string;
    action?: ReactNode;
    live?: boolean;
};

const GROUND: Record<BannerTone, string> = {
    offline: color.ink,
    warning: color.dueSoft,
    info: color.canvas,
    success: color.successSoft,
};

const TEXT: Record<BannerTone, TextTone> = {
    offline: 'inverse',
    warning: 'due',
    info: 'ink2',
    success: 'success',
};

export function Banner({ tone = 'info', message, action, live = false }: BannerProps) {
    const t = useT();

    return (
        <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: GROUND[tone] }]}>
            <Dot tone={tone === 'offline' ? 'due' : tone === 'success' ? 'success' : 'due'} pulse={live} />
            <Text variant="subhead" tone={TEXT[tone]} style={styles.message}>
                {t(message)}
            </Text>
            {action}
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        gap: space[2.5],
        minHeight: size.row,
        paddingHorizontal: size.gutter,
        paddingVertical: space[2],
    },
    message: { flex: 1 },
});
