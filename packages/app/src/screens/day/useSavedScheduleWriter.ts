// biome-ignore lint/style/noRestrictedImports: a timer and a `/ws` subscription, both outside React
import { useEffect } from 'react';
import { onServerChange, serverAddresses, serverNow, useConnection, useDeviceBackend } from '../../api';
import { api } from './data';
import { serverIdentity, takeSchedule } from './savedSchedule';
import { saveSchedule } from './savedScheduleStore';
import { addDays, todayKey } from './time';

const EVERY_MS = 10 * 60 * 1000;
const AFTER_CHANGE_MS = 5_000;

export function useSavedScheduleWriter(enabled: boolean): void {
    const { status } = useConnection();
    const device = useDeviceBackend();
    const active = enabled && status === 'online' && device.hydrated && device.backend === null;

    useEffect(() => {
        if (!active) return;

        let busy = false;
        let again = false;
        let stopped = false;

        async function take(): Promise<void> {
            const server = serverIdentity(serverAddresses());
            if (!server) return;
            if (busy) {
                again = true;
                return;
            }
            busy = true;
            try {
                const today = todayKey();
                const dates = [today, addDays(today, 1)];
                const [days, branches] = await Promise.all([api.byDates(dates), api.branches()]);
                if (stopped) return;
                await saveSchedule(
                    takeSchedule({
                        server,
                        savedAt: serverNow(),
                        branches,
                        days: dates.map((date, index) => ({ date, appointments: days[index] ?? [] })),
                    }),
                );
            } catch {
            } finally {
                busy = false;
                if (again && !stopped) {
                    again = false;
                    void take();
                }
            }
        }

        void take();
        const interval = setInterval(() => void take(), EVERY_MS);

        let pending: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = onServerChange(() => {
            if (pending) clearTimeout(pending);
            pending = setTimeout(() => void take(), AFTER_CHANGE_MS);
        });

        return () => {
            stopped = true;
            clearInterval(interval);
            if (pending) clearTimeout(pending);
            unsubscribe();
        };
    }, [active]);
}
