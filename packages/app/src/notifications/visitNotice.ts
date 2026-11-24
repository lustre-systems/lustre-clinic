import { type ClientRole, WS_EVENT } from '@lustre/shared';
import type { ServerEvent } from '../api/serverEvents';

export const NOTICE_MAX_AGE_MS = 10 * 60_000;

export function completionToAnnounce(event: ServerEvent, role: ClientRole, now: number): string | null {
    if (role !== 'secretary' || event.event !== WS_EVENT.VISIT_COMPLETED || !event.id) return null;
    if (now - event.at > NOTICE_MAX_AGE_MS) return null;
    return event.id;
}

export function noticeIdentifier(appointmentId: string): string {
    return `lustre.visit.completed.${appointmentId}`;
}

export function arrivalToAnnounce(event: ServerEvent, role: ClientRole, now: number): string | null {
    if (role !== 'doctor' || event.event !== WS_EVENT.APPOINTMENT_CHECKED_IN || !event.id) return null;
    if (now - event.at > NOTICE_MAX_AGE_MS) return null;
    return event.id;
}

export function arrivalIdentifier(appointmentId: string): string {
    return `lustre.visit.arrived.${appointmentId}`;
}
