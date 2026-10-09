/**
 * What the desk can do to a booking, and on which day. The appointment sheet
 * and the booking page both ask, so a booking on Thursday offers the same
 * writes wherever it was opened from.
 *
 * Cancelling and moving are for any booking still to come, whatever day it is
 * on: the patient rings on Monday to call off Thursday. Checking in and
 * marking a no-show are about the day itself — nobody arrives or fails to
 * arrive for an appointment that has not happened — so check-in waits for the
 * appointment's own day (the server refuses it on any other) and a no-show
 * waits until that day has started.
 *
 * Only `booked` rows get any of these. Once the patient is in, the visit is
 * what moves on, and a settled row is history.
 */
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
