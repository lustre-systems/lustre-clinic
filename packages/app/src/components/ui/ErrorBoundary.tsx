import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { color, radius, space, Text } from '../../theme';
import { Button } from './Button';

export type ErrorBoundaryProps = {
    children: ReactNode;
    title: string;
    message: string;
    actionLabel?: string;
    icon?: ReactNode;
    resetKey?: unknown;
    onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
    failed: boolean;
    resetKey: unknown;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    override state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

    static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
        return { failed: true };
    }

    static getDerivedStateFromProps(
        props: ErrorBoundaryProps,
        state: ErrorBoundaryState,
    ): Partial<ErrorBoundaryState> | null {
        if (props.resetKey === state.resetKey) return null;
        return { failed: false, resetKey: props.resetKey };
    }

    override componentDidCatch(error: Error, info: ErrorInfo) {
        this.props.onError?.(error, info);
    }

    private retry = () => this.setState({ failed: false });

    override render() {
        if (!this.state.failed) return this.props.children;

        return (
            <Fallback
                title={this.props.title}
                message={this.props.message}
                icon={this.props.icon}
                actionLabel={this.props.actionLabel ?? 'Reload'}
                onRetry={this.retry}
            />
        );
    }
}

function Fallback({
    title,
    message,
    icon,
    actionLabel,
    onRetry,
}: {
    title: string;
    message: string;
    icon?: ReactNode;
    actionLabel: string;
    onRetry: () => void;
}) {
    const t = useT();

    return (
        <View style={styles.root}>
            <View style={styles.card}>
                {icon ? <View style={styles.glyph}>{icon}</View> : null}

                <Text variant="title3">{t(title)}</Text>
                <Text variant="subhead" tone="muted" style={styles.body}>
                    {t(message)}
                </Text>

                <Button
                    label={actionLabel}
                    onPress={onRetry}
                    variant="primary"
                    size="lg"
                    block
                    style={styles.action}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: color.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[5],
    },
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
    action: { marginTop: space[4] },
});
