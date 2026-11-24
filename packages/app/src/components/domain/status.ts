import { type AppointmentStatus, localizeCopy } from '@lustre/shared';
import { getLocale } from '../../i18n/runtime';

export type StatusTone = 'muted' | 'accent' | 'due' | 'success';

const LABEL: Record<AppointmentStatus, string> = {
    booked: 'Booked',
    checked_in: 'In the chair',
    awaiting_payment: 'At the desk',
    done: 'Done',
    cancelled: 'Cancelled',
    no_show: 'No-show',
};

const TONE = {
    booked: 'muted',
    checked_in: 'accent',
    awaiting_payment: 'due',
    done: 'success',
    cancelled: 'muted',
    no_show: 'due',
} as const satisfies Record<AppointmentStatus, StatusTone>;

function waiting(status: AppointmentStatus, inChair: boolean | undefined): boolean {
    return status === 'checked_in' && inChair === false;
}

export function statusCopy(status: AppointmentStatus, inChair?: boolean): string {
    if (status !== 'checked_in') return LABEL[status];
    if (inChair === undefined) return 'Checked in';
    return inChair ? LABEL.checked_in : 'Waiting';
}

export function statusLabel(status: AppointmentStatus, inChair?: boolean): string {
    return localizeCopy(getLocale(), statusCopy(status, inChair));
}

export function statusTone(status: AppointmentStatus, inChair?: boolean): StatusTone {
    return waiting(status, inChair) ? 'due' : TONE[status];
}

export type BadgeTone = 'ink' | 'success' | 'due' | 'muted';

const BADGE = {
    booked: 'muted',
    checked_in: 'due',
    awaiting_payment: 'ink',
    done: 'success',
    cancelled: 'muted',
    no_show: 'due',
} as const satisfies Record<AppointmentStatus, BadgeTone>;

export function badgeTone(status: AppointmentStatus, inChair?: boolean): BadgeTone {
    return status === 'checked_in' && inChair !== false ? 'ink' : BADGE[status];
}
