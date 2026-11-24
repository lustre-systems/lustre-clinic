import { StyleSheet } from 'react-native';
import { useT } from '../../i18n';
import { space, Text } from '../../theme';
import { Button } from './Button';
import { Card } from './Card';

export type ErrorStateProps = {
    message: string;
    onRetry: () => void;
    retrying?: boolean;
};

export function ErrorState({ message, onRetry, retrying = false }: ErrorStateProps) {
    const t = useT();
    return (
        <Card variant="dashed" padded style={styles.state}>
            <Text variant="headline">{t("Couldn't load this")}</Text>
            <Text variant="subhead" tone="muted" style={styles.message}>
                {message}
            </Text>
            <Button
                label="Try again"
                variant="secondary"
                onPress={onRetry}
                loading={retrying}
                style={styles.action}
            />
        </Card>
    );
}

const styles = StyleSheet.create({
    state: { alignItems: 'center', gap: space[2] },
    message: { textAlign: 'center' },
    action: { alignSelf: 'center' },
});
