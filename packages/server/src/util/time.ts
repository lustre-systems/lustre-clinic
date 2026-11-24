import { callerWallClock, pad2 } from '@lustre/shared';

export function ageFromBirthDate(birthDate: string | null, on: Date = new Date()): number | null {
    if (!birthDate) return null;

    const born = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return null;

    let age = on.getUTCFullYear() - born.getUTCFullYear();
    const monthDiff = on.getUTCMonth() - born.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < born.getUTCDate())) {
        age -= 1;
    }
    return age < 0 ? null : age;
}

export { clinicDayOf, dayRange } from '@lustre/shared';

export function refDatePart(at: Date, offsetMinutes = 0): string {
    const { year, month, day } = callerWallClock(at, offsetMinutes);
    return `${pad2(day)}${pad2(month)}${pad2(year % 100)}`;
}
