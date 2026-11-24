export type CalendarState = {
    open: boolean;
    seq: number;
};

export const CALENDAR_CLOSED: CalendarState = { open: false, seq: 0 };

export function openCalendar(current: CalendarState): CalendarState {
    if (current.open) return current;
    return { open: true, seq: current.seq + 1 };
}

export function closeCalendar(current: CalendarState): CalendarState {
    if (!current.open) return current;
    return { ...current, open: false };
}
