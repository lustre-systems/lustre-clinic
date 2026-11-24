import type { ClientRole } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: subscribes to the `/ws` event stream, outside React
import { useEffect } from 'react';
import { onServerEvent, serverNow, trpcClient, useDeviceBackend } from '../api';
import { presentArrivalNotice } from './notifications';
import { arrivalToAnnounce } from './visitNotice';

async function announce(appointmentId: string, stillWanted: () => boolean): Promise<void> {
    const name = await trpcClient.appointment.byId.query({ id: appointmentId }).then(
        (appointment) => appointment.patient.name,
        () => null,
    );
    if (stillWanted()) await presentArrivalNotice(appointmentId, name);
}

export function useArrivalNotices(role: ClientRole | null): void {
    const onDevice = useDeviceBackend().backend !== null;

    useEffect(() => {
        if (role !== 'doctor' || onDevice) return;
        let active = true;
        const unsubscribe = onServerEvent((event) => {
            const appointmentId = arrivalToAnnounce(event, role, serverNow());
            if (appointmentId) void announce(appointmentId, () => active).catch(() => undefined);
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, [role, onDevice]);
}
