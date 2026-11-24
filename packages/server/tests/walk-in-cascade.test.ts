import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { AppointmentStatus } from '@lustre/shared';
import { db } from '../src/db/index.ts';
import { makeRoomForWalkIn } from '../src/modules/appointment/appointment.service.ts';
import { insertBranch, insertPatient, setupDatabase, sql, truncateAll, uuid } from './helpers/db.ts';

const BASE = new Date('2026-03-10T09:00:00.000Z');

const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60_000);
const minutesOf = (value: Date) => Math.round((value.getTime() - BASE.getTime()) / 60_000);

let branchId: string;
let patientId: string;
let refCounter = 0;

async function book(
    startMinutes: number,
    durationMinutes: number,
    status: AppointmentStatus = 'booked',
): Promise<string> {
    refCounter += 1;
    const id = uuid();
    await sql`
        INSERT INTO appointments (id, ref, patient_id, branch_id, starts_at, duration_minutes, status)
        VALUES (
            ${id}, ${`100326-W${String(refCounter).padStart(3, '0')}`}, ${patientId}, ${branchId},
            ${at(startMinutes).toISOString()}, ${durationMinutes}, ${status}
        )
    `;
    return id;
}

async function startOf(id: string): Promise<number> {
    const [row] = await sql`SELECT starts_at FROM appointments WHERE id = ${id}`;
    return minutesOf(new Date(row?.starts_at as string));
}

const room = (startMinutes: number, durationMinutes: number) =>
    makeRoomForWalkIn(db, at(startMinutes), durationMinutes);

const makeRoom = async (startMinutes: number, durationMinutes: number) =>
    (await room(startMinutes, durationMinutes)).moved;

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
    refCounter = 0;
    branchId = await insertBranch();
    patientId = await insertPatient();
});

describe('a walk-in making room', () => {
    test('moves nothing when the walk-in fits in a gap', async () => {
        const later = await book(60, 30);

        expect(await makeRoom(0, 30)).toEqual([]);
        expect(await startOf(later)).toBe(60);
    });

    test('moves nothing when a booking begins exactly as the walk-in ends', async () => {
        const later = await book(30, 30);

        expect(await makeRoom(0, 30)).toEqual([]);
        expect(await startOf(later)).toBe(30);
    });

    test('pushes the booking it runs into to the moment it ends', async () => {
        const clash = await book(20, 30);

        const moved = await makeRoom(0, 30);

        expect(moved).toHaveLength(1);
        expect(moved.map((move) => [minutesOf(move.from), minutesOf(move.to)])).toEqual([[20, 30]]);
        expect(await startOf(clash)).toBe(30);
    });

    test('ripples through a solid run of bookings', async () => {
        const first = await book(20, 30);
        const second = await book(50, 30);
        const third = await book(80, 30);

        const moved = await makeRoom(0, 30);

        expect(moved).toHaveLength(3);
        expect(await startOf(first)).toBe(30);
        expect(await startOf(second)).toBe(60);
        expect(await startOf(third)).toBe(90);
    });

    test('lets a gap absorb the walk-in and stops the ripple there', async () => {
        const clash = await book(20, 30);
        const afterGap = await book(120, 30);

        const moved = await makeRoom(0, 30);

        expect(moved.map((row) => row.id)).toEqual([clash]);
        expect(await startOf(clash)).toBe(30);
        expect(await startOf(afterGap)).toBe(120);
    });

    test('leaves cancelled and no-show rows where they are', async () => {
        const cancelled = await book(20, 30, 'cancelled');
        const missed = await book(20, 30, 'no_show');

        expect(await makeRoom(0, 30)).toEqual([]);
        expect(await startOf(cancelled)).toBe(20);
        expect(await startOf(missed)).toBe(20);
    });

    test('pushes a checked-in patient whose slot has not started, who also holds a slot', async () => {
        const seated = await book(20, 30, 'checked_in');

        expect(await makeRoom(0, 30)).toHaveLength(1);
        expect(await startOf(seated)).toBe(30);
    });

    test('starts when the chair frees, leaving the running slot alone', async () => {
        const running = await book(-10, 30, 'checked_in');

        const { startsAt, moved } = await room(0, 30);

        expect(minutesOf(startsAt)).toBe(20);
        expect(moved).toEqual([]);
        expect(await startOf(running)).toBe(-10);
    });

    test('cascades from the freed chair, not from the arrival', async () => {
        const running = await book(-10, 30, 'checked_in');
        const next = await book(30, 30);
        const afterGap = await book(120, 30);

        const { startsAt, moved } = await room(0, 30);

        expect(minutesOf(startsAt)).toBe(20);
        expect(moved.map((move) => move.id)).toEqual([next]);
        expect(await startOf(running)).toBe(-10);
        expect(await startOf(next)).toBe(50);
        expect(await startOf(afterGap)).toBe(120);
    });

    test('takes the chair the moment a slot ends, not a minute after', async () => {
        const justEnded = await book(-30, 30, 'checked_in');

        const { startsAt, moved } = await room(0, 30);

        expect(minutesOf(startsAt)).toBe(0);
        expect(moved).toEqual([]);
        expect(await startOf(justEnded)).toBe(-30);
    });

    test('ignores a running slot that holds no chair', async () => {
        const cancelled = await book(-10, 30, 'cancelled');

        const { startsAt, moved } = await room(0, 30);

        expect(minutesOf(startsAt)).toBe(0);
        expect(moved).toEqual([]);
        expect(await startOf(cancelled)).toBe(-10);
    });

    test('leaves tomorrow alone when a gap stands before it', async () => {
        const tomorrow = await book(24 * 60 + 30, 30);

        expect(await makeRoom(14 * 60 + 50, 30)).toEqual([]);
        expect(await startOf(tomorrow)).toBe(24 * 60 + 30);
    });

    const MIDNIGHT = 15 * 60;

    test('sees a row an earlier walk-in already pushed past midnight', async () => {
        const lateTonight = await book(MIDNIGHT - 20, 30);
        const pastMidnight = await book(MIDNIGHT + 10, 30);

        const moved = await makeRoom(MIDNIGHT - 30, 30);

        expect(moved.map((move) => move.id)).toEqual([lateTonight, pastMidnight]);
        expect(await startOf(lateTonight)).toBe(MIDNIGHT);
        expect(await startOf(pastMidnight)).toBe(MIDNIGHT + 30);
    });

    test('pushes a booking just past midnight that the walk-in runs into', async () => {
        const justAfter = await book(MIDNIGHT + 10, 30);

        const moved = await makeRoom(MIDNIGHT - 10, 30);

        expect(moved.map((move) => move.id)).toEqual([justAfter]);
        expect(await startOf(justAfter)).toBe(MIDNIGHT + 20);
    });

    test('leaves the day untouched when there is nothing after the walk-in', async () => {
        const earlier = await book(-60, 30);

        expect(await makeRoom(0, 30)).toEqual([]);
        expect(await startOf(earlier)).toBe(-60);
    });
});
