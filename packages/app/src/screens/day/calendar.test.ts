import { describe, expect, it } from 'bun:test';
import { CALENDAR_CLOSED, closeCalendar, openCalendar } from './calendar';

describe('opening the calendar', () => {
    it('counts the opening, so the sheet remounts onto the day the screen is on', () => {
        expect(openCalendar(CALENDAR_CLOSED)).toEqual({ open: true, seq: 1 });
    });

    it('counts every opening, so reopening is a fresh month and not the last one', () => {
        const first = openCalendar(CALENDAR_CLOSED);
        const second = openCalendar(closeCalendar(first));

        expect(second.seq).toBe(2);
    });

    it('spends a tap that lands while the sheet is already up', () => {
        const open = openCalendar(CALENDAR_CLOSED);

        expect(openCalendar(open)).toBe(open);
    });
});

describe('closing the calendar', () => {
    it('keeps the count, so the next opening is still distinguishable', () => {
        expect(closeCalendar(openCalendar(CALENDAR_CLOSED))).toEqual({ open: false, seq: 1 });
    });

    it('spends a close that lands on a sheet already down', () => {
        expect(closeCalendar(CALENDAR_CLOSED)).toBe(CALENDAR_CLOSED);
    });
});

describe('calendar cell edges', () => {
    async function cellSource() {
        const source = await Bun.file(new URL('./components/CalendarSheet.tsx', import.meta.url)).text();
        return source.slice(
            source.indexOf('<View style={styles.cellBox}>'),
            source.indexOf('<Text', source.indexOf('<View style={styles.cellBox}>')),
        );
    }

    it('keeps the closed edge when the closed day is selected', async () => {
        const source = await cellSource();

        expect(source).toMatch(
            /\{closed \? \(?\s*<View pointerEvents="none" style=\{styles\.closedEdge\} \/>\s*\)? : null\}/,
        );
        expect(source).not.toMatch(/!picked\s*&&\s*closed/);
    });

    it('paints the closed edge on its own layer instead of toggling the clipped cell border', async () => {
        const source = await cellSource();

        expect(source).toStartWith('<View style={styles.cellBox}>');
        expect(source.indexOf('styles.fill')).toBeLessThan(source.indexOf('styles.closedEdge'));
    });
});
