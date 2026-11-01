import { useQuery } from '@tanstack/react-query';
// biome-ignore lint/style/noRestrictedImports: the `AppState` subscription that re-measures when the phone comes back to the front
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { adoptClinicZone, clockSample, hydrateClinicZone, noteServerClock, trpcClient } from '../api';
import { clockSkew } from './clockCheck';

const RECHECK_MS = 5 * 60_000;

void hydrateClinicZone();

/**
 * Keeps the app on the clinic's time (`clinicTime`): measures how far the
 * server's clock is from this phone's, and takes the clinic zone's offsets
 * from the server. Nothing is shown. The phone's zone no longer matters, and
 * its clock only through the skew, so there is nothing at the desk to fix.
 */
export function useClinicClock(): void {
    const check = useQuery({
        queryKey: ['clock-check'],
        queryFn: async () => {
            const sent = clockSample();
            const server = await trpcClient.health.clock.query();
            const received = clockSample();
            const skew = clockSkew(server.now, sent, received);
            if (skew !== null) noteServerClock(skew, received);
            // Absent on a server from before `clinicTime`, which leaves the stored or bundled table.
            adoptClinicZone(server.zone);
            return skew;
        },
        refetchInterval: RECHECK_MS,
    });

    const { refetch } = check;
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') void refetch();
        });
        return () => subscription.remove();
    }, [refetch]);
}
