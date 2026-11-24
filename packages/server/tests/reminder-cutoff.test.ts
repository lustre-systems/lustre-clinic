import { afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { appointmentService } from '../src/modules/appointment/appointment.service.ts';
import { reminderService } from '../src/modules/reminder/reminder.service.ts';
import { settingsService } from '../src/modules/settings/settings.service.ts';
import { setupDatabase, truncateAll } from './helpers/db.ts';
import { clinic } from './helpers/factories.ts';

const HOUR = 3_600_000;

const DAY = (() => {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() + 2);
    at.setUTCHours(0, 0, 0, 0);
    return at.getTime();
})();

function onDay(hours: number): Date {
    return new Date(DAY + hours * HOUR);
}

async function dueAt(now: Date, input: { offsetMinutes: number; throughToday?: boolean }) {
    setSystemTime(now);
    try {
        const rows = await reminderService.pending({ dueOnly: true, limit: 100, ...input });
        return rows.map((row) => new Date(row.startsAt).getTime());
    } finally {
        setSystemTime();
    }
}

let morning: number;
let evening: number;
let afterMidnight: number;

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
    await settingsService.update({ reminderLeadHours: 24, reminderNotifyAt: '17:00' });

    const fixtures = await clinic();
    const book = async (startsAt: Date) =>
        (
            await appointmentService.create({
                patient: { kind: 'existing', patientId: fixtures.patient.id },
                branchId: fixtures.branch.id,
                startsAt: startsAt.toISOString(),
                offsetMinutes: 0,
            })
        ).startsAt.getTime();

    morning = await book(onDay(24 + 10));
    evening = await book(onDay(24 + 20));
    afterMidnight = await book(onDay(48 + 1));
});

afterEach(() => {
    setSystemTime();
});

describe('reminder.pending, due only', () => {
    test('before the notify time, only what is due by now', async () => {
        expect(await dueAt(onDay(11), { offsetMinutes: 0 })).toEqual([morning]);
    });

    test('from the notify time, the rest of the day in one list', async () => {
        expect(await dueAt(onDay(17), { offsetMinutes: 0 })).toEqual([morning, evening]);
    });

    test('never past the clinic midnight', async () => {
        expect(await dueAt(onDay(23.9), { offsetMinutes: 0 })).not.toContain(afterMidnight);
    });

    test('with throughToday, the rest of the day from the morning', async () => {
        expect(await dueAt(onDay(9), { offsetMinutes: 0 })).toEqual([]);
        expect(await dueAt(onDay(9), { offsetMinutes: 0, throughToday: true })).toEqual([morning, evening]);
    });

    test('reads the notify time and midnight in the clinic day, from offsetMinutes', async () => {
        expect(await dueAt(onDay(13 + 59 / 60), { offsetMinutes: 180 })).toEqual([morning]);
        expect(await dueAt(onDay(14), { offsetMinutes: 180 })).toEqual([morning, evening]);
    });

    test('without dueOnly, every pending reminder as before', async () => {
        setSystemTime(onDay(9));
        const rows = await reminderService.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
        expect(rows.map((row) => new Date(row.startsAt).getTime())).toEqual([
            morning,
            evening,
            afterMidnight,
        ]);
    });
});
