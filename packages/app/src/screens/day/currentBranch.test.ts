import { describe, expect, it } from 'bun:test';
import { pickedOn, scheduledBranch } from './currentBranch';
import type { ClinicDay } from './data/types';

const schedule: ClinicDay[] = [
    { weekday: 3, branchId: 'maadi', opensAt: '10:00', closesAt: '22:00' },
    { weekday: 4, branchId: 'zamalek', opensAt: '10:00', closesAt: '22:00' },
];

describe('pickedOn', () => {
    it('holds a pick on the day it was made', () => {
        expect(pickedOn({ day: '2026-09-24', branchId: 'zamalek' }, '2026-09-24')).toBe('zamalek');
    });

    it('drops it the next day', () => {
        expect(pickedOn({ day: '2026-09-24', branchId: 'zamalek' }, '2026-09-25')).toBeNull();
    });

    it('has nothing before anything is picked', () => {
        expect(pickedOn(null, '2026-09-24')).toBeNull();
    });
});

describe('scheduledBranch', () => {
    it("is the branch working that date's weekday", () => {
        expect(scheduledBranch('2026-09-23', schedule)).toBe('maadi');
        expect(scheduledBranch('2026-09-24', schedule)).toBe('zamalek');
    });

    it('is null on a closed day or before the schedule loads', () => {
        expect(scheduledBranch('2026-09-25', schedule)).toBeNull();
        expect(scheduledBranch('2026-09-24', undefined)).toBeNull();
    });
});
