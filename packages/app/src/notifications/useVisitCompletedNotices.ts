import { type ClientRole, localizeCopy } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: subscribes to the `/ws` event stream and `AppState`, and runs the Android foreground service — all outside React
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { startListening, stopListening } from '../../modules/lustre-listener';
import { onServerEvent, serverNow, trpcClient, useDeviceBackend } from '../api';
import { getLocale } from '../i18n/runtime';
import { ensurePermission, notificationsAllowed, presentVisitNotice } from './notifications';
import { completionToAnnounce } from './visitNotice';

async function announce(appointmentId: string): Promise<void> {
    const name = await trpcClient.appointment.byId.query({ id: appointmentId }).then(
        (appointment) => appointment.patient.name,
        () => null,
    );
    await presentVisitNotice(appointmentId, name);
}

function listen(): void {
    const t = (copy: string) => localizeCopy(getLocale(), copy);
    startListening({
        title: t('Listening for the doctor'),
        body: t('You will be told when a patient is coming to the desk.'),
        channelName: t('Staying connected to the clinic'),
    });
}

export function useVisitCompletedNotices(role: ClientRole | null): void {
    const onDevice = useDeviceBackend().backend !== null;

    useEffect(() => {
        if (role !== 'secretary' || onDevice) return;
        let active = true;

        void ensurePermission().then((granted) => {
            if (active && granted) listen();
        });
        const foreground = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;
            void notificationsAllowed().then((granted) => {
                if (active && granted) listen();
            });
        });
        const unsubscribe = onServerEvent((event) => {
            const appointmentId = completionToAnnounce(event, role, serverNow());
            if (appointmentId) void announce(appointmentId).catch(() => undefined);
        });

        return () => {
            active = false;
            foreground.remove();
            unsubscribe();
            stopListening();
        };
    }, [role, onDevice]);
}
