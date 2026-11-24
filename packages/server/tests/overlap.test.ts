import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { AppointmentStatus } from '@lustre/shared';
import { insertBranch, insertPatient, setupDatabase, sql, truncateAll, uuid } from './helpers/db.ts';

const BASE = new Date('2026-03-10T09:00:00.000Z');

function at(minutes: number): string {
    return new Date(BASE.getTime() + minutes * 60_000).toISOString();
}

let branchId: string;
let patientId: string;
let refCounter = 0;

function nextRef(): string {
    refCounter += 1;
    return `100326-T${String(refCounter).padStart(3, '0')}`;
}

async function book(
    startMinutes: number,
    durationMinutes: number,
    status: AppointmentStatus = 'booked',
): Promise<string> {
    const id = uuid();
    await sql`
        INSERT INTO appointments (id, ref, patient_id, branch_id, starts_at, duration_minutes, status)
        VALUES (${id}, ${nextRef()}, ${patientId}, ${branchId}, ${at(startMinutes)}, ${durationMinutes}, ${status})
    `;
    return id;
}

async function expectOverlap(fn: () => Promise<unknown>): Promise<void> {
    let code: string | undefined;
    try {
        await fn();
    } catch (err) {
        code = (err as { code?: string }).code;
    }
    expect(code).toBe('23P01');
}

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    await truncateAll();
    branchId = await insertBranch();
    patientId = await insertPatient();
});

describe('appointments_no_overlap', () => {
    test('rejects an identical start and duration', async () => {
        await book(0, 30);
        await expectOverlap(() => book(0, 30));
    });

    test('rejects an identical start with a different duration', async () => {
        await book(0, 30);
        await expectOverlap(() => book(0, 10));
    });

    test('allows one ending exactly when the next begins', async () => {
        await book(0, 30);
        const id = await book(30, 30);
        expect(id).toBeTruthy();
    });

    test('allows one beginning exactly when the previous ends, booked in reverse', async () => {
        await book(30, 30);
        const id = await book(0, 30);
        expect(id).toBeTruthy();
    });

    test('rejects a fully contained appointment', async () => {
        await book(0, 60);
        await expectOverlap(() => book(15, 10));
    });

    test('rejects an appointment that spans an existing one', async () => {
        await book(20, 10);
        await expectOverlap(() => book(0, 60));
    });

    test('rejects an overlap on the leading edge', async () => {
        await book(30, 30);
        await expectOverlap(() => book(15, 30));
    });

    test('rejects an overlap on the trailing edge', async () => {
        await book(0, 30);
        await expectOverlap(() => book(15, 30));
    });

    test('rejects an overlap of a single minute', async () => {
        await book(0, 30);
        await expectOverlap(() => book(29, 30));
    });

    test('allows a gap of a single minute', async () => {
        await book(0, 30);
        const id = await book(31, 30);
        expect(id).toBeTruthy();
    });

    test('ignores cancelled appointments', async () => {
        await book(0, 30, 'cancelled');
        const id = await book(0, 30);
        expect(id).toBeTruthy();
    });

    test('ignores no-show appointments', async () => {
        await book(0, 30, 'no_show');
        const id = await book(0, 30);
        expect(id).toBeTruthy();
    });

    test('a done appointment does not hold its slot', async () => {
        await book(0, 30, 'done');
        const id = await book(0, 30);
        expect(id).toBeTruthy();
    });

    test('an appointment awaiting payment does not hold its slot', async () => {
        await book(0, 30, 'awaiting_payment');
        const id = await book(0, 30);
        expect(id).toBeTruthy();
    });

    test('a checked-in appointment holds its slot', async () => {
        await book(0, 30, 'checked_in');
        await expectOverlap(() => book(0, 30));
    });

    test('cancelling frees the slot for a new booking', async () => {
        const first = await book(0, 30);
        await expectOverlap(() => book(0, 30));

        await sql`UPDATE appointments SET status = 'cancelled' WHERE id = ${first}`;

        const second = await book(0, 30);
        expect(second).toBeTruthy();
    });

    test('rejects reinstating a cancelled appointment into a taken slot', async () => {
        const first = await book(0, 30, 'cancelled');
        await book(0, 30);

        await expectOverlap(() => sql`UPDATE appointments SET status = 'booked' WHERE id = ${first}`);
    });

    test('rejects moving an appointment onto another', async () => {
        await book(0, 30);
        const second = await book(60, 30);

        await expectOverlap(() => sql`UPDATE appointments SET starts_at = ${at(10)} WHERE id = ${second}`);
    });

    test('rejects extending an appointment into the next one', async () => {
        const first = await book(0, 30);
        await book(30, 30);

        await expectOverlap(() => sql`UPDATE appointments SET duration_minutes = 45 WHERE id = ${first}`);
    });

    test('overlap is enforced across branches — there is one practitioner', async () => {
        const other = await insertBranch('Second');
        await book(0, 30);

        const id = uuid();
        await expectOverlap(
            () => sql`
                INSERT INTO appointments (id, ref, patient_id, branch_id, starts_at, duration_minutes)
                VALUES (${id}, ${nextRef()}, ${patientId}, ${other}, ${at(0)}, 30)
            `,
        );
    });
});

describe('appointment_span', () => {
    test('is half-open at the end', async () => {
        const [row] = await sql<{ contains_start: boolean; contains_end: boolean }[]>`
            SELECT
                appointment_span(${at(0)}::timestamptz, 30) @> ${at(0)}::timestamptz  AS contains_start,
                appointment_span(${at(0)}::timestamptz, 30) @> ${at(30)}::timestamptz AS contains_end
        `;
        expect(row?.contains_start).toBe(true);
        expect(row?.contains_end).toBe(false);
    });

    test('is unaffected by the session timezone', async () => {
        const ends = async (zone: string) =>
            sql.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL TIME ZONE '${zone}'`);

                const [check] = await tx<{ zone: string }[]>`
                    SELECT current_setting('TimeZone') AS zone
                `;
                expect(check?.zone).toBe(zone);

                const [row] = await tx<{ correct: boolean }[]>`
                    SELECT upper(appointment_span(${at(0)}::timestamptz, 90)) = ${at(90)}::timestamptz
                        AS correct
                `;
                return row?.correct;
            });

        expect(await ends('UTC')).toBe(true);
        expect(await ends('Africa/Cairo')).toBe(true);
        expect(await ends('America/New_York')).toBe(true);
    });

    test('leaves no pooled connection in a foreign timezone', async () => {
        const zones = await Promise.all(
            Array.from(
                { length: 10 },
                async () =>
                    (await sql<{ zone: string }[]>`SELECT current_setting('TimeZone') AS zone`)[0]?.zone,
            ),
        );

        expect(zones.every((zone) => zone === 'UTC')).toBe(true);
    });
});

describe('column constraints', () => {
    test('rejects a non-positive duration', async () => {
        let code: string | undefined;
        try {
            await book(0, 0);
        } catch (err) {
            code = (err as { code?: string }).code;
        }
        expect(code).toBe('23514');
    });

    test('rejects a second visit for the same appointment', async () => {
        const appointmentId = await book(0, 30, 'checked_in');
        await sql`
            INSERT INTO visits (id, appointment_id, checked_in_at)
            VALUES (${uuid()}, ${appointmentId}, now())
        `;

        let code: string | undefined;
        try {
            await sql`
                INSERT INTO visits (id, appointment_id, checked_in_at)
                VALUES (${uuid()}, ${appointmentId}, now())
            `;
        } catch (err) {
            code = (err as { code?: string }).code;
        }
        expect(code).toBe('23505');
    });

    test("rejects a payment with method 'other' and no note", async () => {
        const appointmentId = await book(0, 30, 'checked_in');
        const visitId = uuid();
        await sql`
            INSERT INTO visits (id, appointment_id, checked_in_at)
            VALUES (${visitId}, ${appointmentId}, now())
        `;

        let code: string | undefined;
        try {
            await sql`
                INSERT INTO payments (id, visit_id, amount, method)
                VALUES (${uuid()}, ${visitId}, 30000, 'other')
            `;
        } catch (err) {
            code = (err as { code?: string }).code;
        }
        expect(code).toBe('23514');
    });

    test('accepts a payment with any other method and no note', async () => {
        const appointmentId = await book(0, 30, 'checked_in');
        const visitId = uuid();
        await sql`
            INSERT INTO visits (id, appointment_id, checked_in_at)
            VALUES (${visitId}, ${appointmentId}, now())
        `;
        await sql`
            INSERT INTO payments (id, visit_id, amount, method)
            VALUES (${uuid()}, ${visitId}, 30000, 'cash')
        `;

        const rows = await sql`SELECT 1 FROM payments WHERE visit_id = ${visitId}`;
        expect(rows.length).toBe(1);
    });

    test('settings is a single enforced row', async () => {
        await sql`
            INSERT INTO settings (id, clinic_name, reminder_template)
            VALUES (1, 'Clinic', 'Reminder: {{time}}')
        `;

        let code: string | undefined;
        try {
            await sql`
                INSERT INTO settings (id, clinic_name, reminder_template)
                VALUES (2, 'Other', 'Reminder: {{time}}')
            `;
        } catch (err) {
            code = (err as { code?: string }).code;
        }
        expect(code).toBe('23514');
    });
});
