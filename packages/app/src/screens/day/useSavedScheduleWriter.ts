// biome-ignore lint/style/noRestrictedImports: a timer and a `/ws` subscription, both outside React
import { useEffect } from 'react';
import { onServerChange, serverAddresses, serverNow, useConnection, useDeviceBackend } from '../../api';
import { api } from './data';
import { serverIdentity, takeSchedule } from './savedSchedule';
import { saveSchedule } from './savedScheduleStore';
import { addDays, todayKey } from './time';

// Every ten minutes and a few seconds after the other phone writes: the
// interval is what carries the copy over midnight, the `/ws` follow is what
// keeps a booking made at 08:59 in a 09:00 power cut.
const EVERY_MS = 10 * 60 * 1000;
const AFTER_CHANGE_MS = 5_000;

/**
 * Keeps `savedSchedule` current while the server answers. Its own read rather
 * than whatever the day screen holds: the day screen may be on next Tuesday,
 * and the doctor's phone never asks for tomorrow at all. A read that fails
 * leaves the last copy alone — taking nothing over a power cut is how the
 * copy would be lost at the moment it is needed.
 *
 * Off in a demo, which has no clinic to lose and must not leave invented
 * patients on disk under a real server's name, and in local mode, whose clinic
 * is on the phone already and never goes offline.
 */
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
                // Kept: the last copy that landed.
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
