import type { Appointment } from './data/types';
import { dateKey } from './time';

export interface BookingActions {
    checkIn: boolean;
    reschedule: boolean;
    noShow: boolean;
    cancel: boolean;
}

const NONE: BookingActions = { checkIn: false, reschedule: false, noShow: false, cancel: false };

export function bookingActions(
    appointment: Pick<Appointment, 'status' | 'startsAt'>,
    today: string,
): BookingActions {
    if (appointment.status !== 'booked') return NONE;

    const day = dateKey(appointment.startsAt);
    return {
        checkIn: day === today,
        reschedule: true,
        noShow: day <= today,
        cancel: true,
    };
}
