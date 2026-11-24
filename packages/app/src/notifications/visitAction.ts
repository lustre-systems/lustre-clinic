import { ERROR_CODE, type ErrorCode } from '@lustre/shared';
import { arrivalQueue } from '../screens/day/chair';
import type { Appointment } from '../screens/day/data/types';
import { busiestBranch, holdsSlot } from '../screens/day/month';

export function chairToFinish(
    day: readonly Appointment[],
    checkedInAt: ReadonlyMap<string, string> = new Map(),
): Appointment | null {
    const branches = [...new Set(day.map((row) => row.branchId))];
    const busiest = busiestBranch(day.filter(holdsSlot), null);
    if (busiest) {
        branches.sort((a, b) => Number(b === busiest) - Number(a === busiest));
    }

    for (const branch of branches) {
        const { chair } = arrivalQueue(
            day.filter((row) => row.branchId === branch),
            checkedInAt,
        );
        if (chair) return chair;
    }
    return null;
}

export function firstName(name: string): string {
    return name.trim().split(/\s+/)[0] ?? '';
}

export type FinishFailure = 'gone' | 'offline' | 'failed';

export function finishFailure(error: { code: ErrorCode; offline: boolean }): FinishFailure {
    if (error.code === ERROR_CODE.INVALID_STATUS_TRANSITION || error.code === ERROR_CODE.NOT_FOUND)
        return 'gone';
    return error.offline ? 'offline' : 'failed';
}

export function failureIdentifier(appointmentId: string): string {
    return `lustre.visit.finish-failed.${appointmentId}`;
}
