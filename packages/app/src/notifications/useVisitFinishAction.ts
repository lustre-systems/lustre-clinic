import { type ClientRole, localizeCopy } from '@lustre/shared';
// biome-ignore lint/style/noRestrictedImports: runs the Android foreground service and subscribes to its action, `/ws` changes and `AppState` — all outside React
import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
    type ListenerNotice,
    onListenerAction,
    startListening,
    stopListening,
    updateListening,
} from '../../modules/lustre-listener';
import { onServerChange, useDeviceBackend } from '../api';
import { getLocale } from '../i18n/runtime';
import { asRequestError } from '../screens/day/data/client';
import { checkInTimes, api as dayApi } from '../screens/day/data/day';
import type { Appointment } from '../screens/day/data/types';
import { todayKey } from '../screens/day/time';
import {
    dismissFinishFailure,
    ensurePermission,
    notificationsAllowed,
    presentFinishFailure,
} from './notifications';
import { chairToFinish, finishFailure, firstName } from './visitAction';

function noticeFor(chair: Appointment): ListenerNotice {
    const t = (copy: string, vars?: Record<string, string>) => localizeCopy(getLocale(), copy, vars);
    return {
        title: t('{name} is in the chair', { name: firstName(chair.patient.name) }),
        body: t('Finish the visit to send them to the desk.'),
        channelName: t('Staying connected to the clinic'),
        publicTitle: t('A visit is in progress'),
        action: { label: t('Finish visit'), id: chair.id, pendingBody: t('Finishing the visit…') },
    };
}

function idleNotice(): ListenerNotice {
    const t = (copy: string) => localizeCopy(getLocale(), copy);
    return {
        title: t('Listening for patients'),
        body: t('You will be told when a patient checks in.'),
        channelName: t('Staying connected to the clinic'),
    };
}

async function readChair(): Promise<Appointment | null> {
    const day = await dayApi.byDate(todayKey());
    const checkedIn = day.filter((row) => row.status === 'checked_in').map((row) => row.id);
    const arrivals = checkedIn.length > 0 ? await checkInTimes(checkedIn) : null;
    return chairToFinish(day, arrivals?.checkedInAt);
}

export function useVisitFinishAction(role: ClientRole | null): void {
    const onDevice = useDeviceBackend().backend !== null;

    useEffect(() => {
        if (role !== 'doctor' || onDevice) return;
        let active = true;
        let generation = 0;
        let shown: Appointment | null = null;
        const finishing = new Set<string>();

        const show = (notice: ListenerNotice): boolean =>
            AppState.currentState === 'active' ? startListening(notice) : updateListening(notice);

        const draw = (chair: Appointment) => {
            shown = show(noticeFor(chair)) ? chair : null;
        };

        const refresh = async () => {
            const mine = ++generation;
            if (!(await notificationsAllowed())) {
                if (!active || mine !== generation) return;
                shown = null;
                stopListening();
                return;
            }
            let chair: Appointment | null;
            try {
                chair = await readChair();
            } catch {
                if (active && mine === generation && shown === null) show(idleNotice());
                return;
            }
            if (!active || mine !== generation) return;
            if (chair && finishing.has(chair.id)) return;
            if (chair) {
                draw(chair);
            } else {
                shown = null;
                show(idleNotice());
            }
        };

        const finish = async (id: string) => {
            if (finishing.has(id)) return;
            finishing.add(id);
            try {
                await dayApi.awaitPayment(id);
                void dismissFinishFailure(id).catch(() => undefined);
            } catch (err) {
                const failure = finishFailure(asRequestError(err));
                if (failure !== 'gone') {
                    const current = shown;
                    if (active && current?.id === id) draw(current);
                    void presentFinishFailure(id, failure === 'offline').catch(() => undefined);
                }
            } finally {
                finishing.delete(id);
            }
            if (active) await refresh();
        };

        void ensurePermission().then(() => {
            if (active) void refresh();
        });
        const foreground = AppState.addEventListener('change', (state) => {
            if (state === 'active') void refresh();
        });
        const changes = onServerChange((areas) => {
            if (areas === 'all' || areas.has('appointment') || areas.has('visit')) void refresh();
        });
        const taps = onListenerAction((id) => void finish(id));

        return () => {
            active = false;
            foreground.remove();
            changes();
            taps();
            stopListening();
        };
    }, [role, onDevice]);
}
