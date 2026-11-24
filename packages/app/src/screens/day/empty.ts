export type EmptyDay = {
    title: string;
    body: string;
    actionLabel?: string;
    glyph: 'calendar' | 'none';
};

export function emptyDay(past: boolean, canBook: boolean): EmptyDay {
    if (past) {
        return {
            title: 'Nothing happened this day',
            body: 'No appointments were booked, and nobody walked in.',
            glyph: 'none',
        };
    }

    if (!canBook) {
        return {
            title: 'Nothing booked',
            body: 'The day is clear. Anything the desk books will appear here.',
            glyph: 'calendar',
        };
    }

    return {
        title: 'Nothing booked',
        body: 'The day is clear. Book someone in for later, or start a walk-in who is at the desk now.',
        actionLabel: 'Book someone in',
        glyph: 'calendar',
    };
}
