import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const DAY_ROOT = path.resolve(import.meta.dir);

async function read(file: string): Promise<string> {
    return Bun.file(path.join(DAY_ROOT, file)).text();
}

describe('the book-next prompt after a check-in', () => {
    it('offers one answer that leaves the day, and it is not Book later', async () => {
        const sheet = await read('components/BookNextSheet.tsx');

        const handlers = [...sheet.matchAll(/^\s{4}(on[A-Z]\w*):/gm)].map((match) => match[1]);

        expect(handlers).toEqual(['onBookNow', 'onLater', 'onClosed']);
    });

    it('sends Book later, the scrim and the hardware back to the same handler', async () => {
        const sheet = await read('components/BookNextSheet.tsx');

        expect(sheet).toContain('onClose={onLater}');
        expect(sheet).toContain('onPress={onLater}');
        expect(sheet).not.toContain('onDismiss');
    });

    it('answers Book later without opening a record', async () => {
        const screen = await read('DayScreen.tsx');

        const later = screen.match(/onLater=\{([^}]*)\}/);
        expect(later?.[1]).toBe('() => stayOnDay(bookNext.patient, bookNext.seated)');

        const stayOnDay = screen.match(/function stayOnDay\([\s\S]*?\n {4}\}/)?.[0] ?? '';
        expect(stayOnDay).not.toBe('');
        expect(stayOnDay).not.toContain('onOpenRecord');
        expect(stayOnDay).not.toContain('pushPage');
        expect(stayOnDay).toContain('setToast');
    });

    it('still takes Book next now into the booking page', async () => {
        const screen = await read('DayScreen.tsx');

        const bookNextOn = screen.match(/function bookNextOn\([\s\S]*?\n {4}\}/)?.[0] ?? '';
        expect(bookNextOn).toContain("pushPage({ name: 'booking'");
    });
});
