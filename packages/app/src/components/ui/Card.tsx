import type { ViewProps } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { color, radius, shadow, space } from '../../theme';

export type CardProps = ViewProps & {
    variant?: 'solid' | 'dashed';
    padded?: boolean;
    elevated?: boolean;
};

export function Card({ variant = 'solid', padded = false, elevated = false, style, ...rest }: CardProps) {
    return (
        <View
            style={[
                styles.card,
                variant === 'dashed' && styles.dashed,
                padded && styles.padded,
                elevated && styles.elevated,
                style,
            ]}
            {...rest}
        />
    );
}

export function CardDivider() {
    return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
    card: {
        borderRadius: radius.xl2,
        borderWidth: 1,
        borderColor: color.line,
        backgroundColor: color.surface,
        overflow: 'hidden',
    },
    dashed: { borderStyle: 'dashed', backgroundColor: color.canvas },
    padded: { padding: space[4] },
    elevated: { boxShadow: shadow.card },
    divider: { height: 1, backgroundColor: color.hair },
});
