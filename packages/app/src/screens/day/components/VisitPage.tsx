import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, PushView } from '../../../components/ui';
import { useT } from '../../../i18n';
import { isOpen, rendered, useRouteStack } from '../../../navigation';
import { color, size, space, Text } from '../../../theme';
import { api, useLocalQuery, type Visit } from '../data';
import { describeError } from '../errors';
import { pricedVisit } from '../money';
import { VisitPaymentScreen } from './VisitPaymentScreen';
import { VisitScreen } from './VisitScreen';
import { VisitViewScreen } from './VisitViewScreen';

export type VisitPageProps = {
    appointmentId: string;
    visitId: string;
    onClose: () => void;
    onChanged?: () => void;
};

type Route = 'treatment' | 'payment';

export function VisitPage({ appointmentId, visitId, onClose, onChanged }: VisitPageProps) {
    const t = useT();
    const [edited, setEdited] = useState<Visit | null>(null);
    const paid = useRef(false);
    const [paying, setPaying] = useState(false);

    const appointment = useLocalQuery(`appointment:${appointmentId}`, () =>
        api.appointmentById(appointmentId),
    );
    const loaded = useLocalQuery(`visit:${visitId}`, () => api.visitById(visitId));

    const visit = edited ?? loaded.data;
    const priced = visit ? pricedVisit(visit) : null;
    const failure = appointment.error ?? loaded.error;

    const closing = useRef(false);

    function close() {
        if (closing.current) return;
        closing.current = true;
        if (edited || paid.current) onChanged?.();
        onClose();
    }

    const routes = useRouteStack<Route>({
        locked: paying,
        atRoot: () => {
            close();
            return true;
        },
    });

    if (failure) {
        return (
            <View style={styles.state}>
                <Banner tone="warning" message={describeError(failure).title} />
                <View style={styles.actions}>
                    <Button label="Try again" variant="text" onPress={appointment.refetch} />
                    <Button label="Back" variant="ghost" onPress={close} />
                </View>
            </View>
        );
    }

    if (!appointment.data || !visit) {
        return (
            <View style={styles.state}>
                <Text variant="subhead" tone="muted">
                    {t('Reading the visit…')}
                </Text>
            </View>
        );
    }

    const appointmentData = appointment.data;

    return (
        <>
            <VisitViewScreen
                appointment={appointmentData}
                visit={visit}
                onBack={close}
                onEdit={() => routes.push('treatment')}
                onDeleted={() => {
                    paid.current = true;
                    close();
                }}
                onPaymentDeleted={(updated) => {
                    paid.current = true;
                    setEdited(updated);
                }}
            />

            {rendered(routes.stack).map(({ id, route }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={routes.settled}
                    testID={`visit-page-${route}`}
                >
                    {route === 'treatment' ? (
                        <VisitScreen
                            key={`edit:${visit.id}`}
                            appointment={appointmentData}
                            visit={visit}
                            mode="checkout"
                            standing="finished"
                            onBack={routes.pop}
                            onConfirm={(priced) => {
                                setEdited(priced);
                                appointment.refetch();
                                routes.push('payment');
                            }}
                        />
                    ) : null}

                    {route === 'payment' && priced ? (
                        <VisitPaymentScreen
                            key={`pay:${visit.id}:${priced.chargedTotal}`}
                            appointment={appointmentData}
                            visit={priced}
                            correcting
                            onWritingChange={setPaying}
                            onBack={routes.pop}
                            onClosed={() => {
                                paid.current = true;
                                close();
                            }}
                        />
                    ) : null}
                </PushView>
            ))}
        </>
    );
}

const styles = StyleSheet.create({
    state: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[3],
        paddingHorizontal: size.gutter,
        backgroundColor: color.canvas,
    },
    actions: { flexDirection: 'row', gap: space[2] },
});
