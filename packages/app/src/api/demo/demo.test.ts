/**
 * The demo backend is the app's server when there is no server, so what is
 * tested here is that it *is one*: that seeding produces a clinic in a state
 * the real one could actually be in, and that the flow a demo walks through —
 * book, check in, take the money — leaves the same rows behind that
 * `packages/server` would.
 *
 * The states that mean "right now" get the most attention, because they are
 * the ones a seed can quietly invent: two patients in the chair at once, a
 * queue nobody is at the front of, a bar measuring from the wrong stamp. Those
 * are the failures that only show up in front of an audience.
 *
 * AsyncStorage is a native module and there is no device under `bun test`, so
 * it is mocked to nothing — persistence is the one part of `db.ts` this cannot
 * reach.
 */
import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';
import {
    instantAt,
    minutesOfDay,
    offsetForDate,
    pad2,
    REMINDER_TOKENS,
    todayKey,
    weekdayOf,
} from '@lustre/shared';

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.resolve(),
        removeItem: () => Promise.resolve(),
        multiGet: () => Promise.resolve([]),
        multiSet: () => Promise.resolve(),
    },
}));

const { getDb, setDb } = await import('./db');
const { seedDemoDb } = await import('./seed');
const { appointmentHandlers } = await import('./handlers/appointment');
const { visitHandlers } = await import('./handlers/visit');
const { balanceHandlers } = await import('./handlers/balance');
const { branchHandlers } = await import('./handlers/branch');
const { patientHandlers } = await import('./handlers/patient');
const { procedureHandlers } = await import('./handlers/procedure');
const { settingsHandlers } = await import('./handlers/settings');
const { reminderHandlers } = await import('./handlers/reminder');
const { statsHandlers } = await import('./handlers/stats');
const { resolve, hasHandler } = await import('./handlers');
const { DemoError } = await import('./rules');
const accessModule = await import('./access');
const { provisionDemo } = await import('./handlers/device');
const { nudgePendingInput, planNudges } = await import('../../notifications/schedule');

function today(): string {
    return todayKey();
}

/** The offset the app sends: minutes east of UTC for the day being asked about. */
function offsetMinutes(): number {
    return offsetForDate(today());
}

beforeEach(() => {
    setDb(seedDemoDb());
});

describe('the seeded day', () => {
    afterEach(() => {
        setSystemTime();
    });

    it('opens on a clinic that is open right now', () => {
        const schedule = settingsHandlers.schedule();
        expect(schedule).toHaveLength(7);

        const day = schedule.find((row) => row.weekday === weekdayOf(today()));
        if (!day) throw new Error('the seed left today closed');

        const minutes = minutesOfDay(Date.now());
        const now = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
        // Zero-padded `HH:MM`, so a string comparison orders them by time.
        expect(day.opensAt <= now).toBe(true);
        expect(day.closesAt >= now).toBe(true);
    });

    /**
     * The branch, not just the row. `clinic_days.weekday` is the primary key, so
     * one weekday names one branch, and the day view opens on the first branch
     * in the register — assigning today to the other one is a demo that opens on
     * "Closed on Tuesdays" with its whole day filed under "booked anyway". The
     * original check only asserted a row existed for today, which that bug
     * passed.
     */
    it('holds today at the branch the day view opens on', () => {
        const opensOn = branchHandlers.list({ includeInactive: false })[0];
        if (!opensOn) throw new Error('the seed registered no branches');

        const day = settingsHandlers.schedule().find((row) => row.weekday === weekdayOf(today()));
        expect(day?.branchId).toBe(opensOn.id);

        // And the day's own appointments are at that branch, or they draw as
        // booked on a day the clinic is somewhere else.
        const appointments = appointmentHandlers.byDate({
            date: today(),
            offsetMinutes: offsetMinutes(),
        });

        expect(appointments.length).toBeGreaterThan(0);
        expect(appointments.every((row) => row.branchId === opensOn.id)).toBe(true);
    });

    /**
     * The demo was seeded on a five-minute grid, so it booked people at 10:25
     * and 11:35 — legal, but nothing like a clinic's book, and the first thing
     * anyone sees. Every seeded start now lands on a ten.
     *
     * The whole table, not just today's: the same grid draws the fortnight of
     * history behind the day view and the week ahead of it, and the opening
     * balance is the row that was written by hand and forgot.
     */
    it('books every appointment on a ten-minute boundary', () => {
        const offGrid = getDb()
            .appointments.filter((row) => minutesOfDay(row.startsAt) % 10 !== 0)
            .map((row) => row.startsAt.toString());

        expect(offGrid).toEqual([]);
    });

    // The picker steps from opening, so an open on a :45 puts every slot it
    // offers back on a five however tidy the seeded rows are.
    //
    // `23:59` is the one close allowed off the grid: between 23:50 and midnight
    // the next ten is 24:00, which `HH:MM` cannot say, and the seed keeps the
    // clinic open past now over keeping the close tidy. CI runs in UTC, so
    // that window is 02:50 in Cairo and it did come up.
    it('opens and closes the clinic on the same boundary', () => {
        for (const day of settingsHandlers.schedule()) {
            expect(Number(day.opensAt.slice(3)) % 10).toBe(0);
            if (day.closesAt !== '23:59') expect(Number(day.closesAt.slice(3)) % 10).toBe(0);
        }
    });

    it('puts exactly one patient in the chair', () => {
        const db = getDb();

        const seated = db.visits.filter((visit) => {
            if (!visit.inChairAt) return false;
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in';
        });

        expect(seated).toHaveLength(1);
    });

    it('leaves a queue behind the chair, and nobody in it seated', () => {
        const db = getDb();

        const waiting = db.visits.filter((visit) => {
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in' && visit.inChairAt === null;
        });

        expect(waiting.length).toBeGreaterThan(0);
    });

    it('has someone at the desk, whose chair time is behind them', () => {
        const db = getDb();

        const atDesk = db.appointments.filter((row) => row.status === 'awaiting_payment');
        expect(atDesk).toHaveLength(1);

        const visit = db.visits.find((row) => row.appointmentId === atDesk[0]?.id);
        // They were in the chair before they went to the desk, so the stamp is
        // set and it is in the past — the case a hand-written row gets wrong.
        expect(visit?.inChairAt).toBeInstanceOf(Date);
        expect(visit?.inChairAt?.getTime()).toBeLessThan(Date.now());
    });

    it('gives every checked-in visit the procedures its booking planned', () => {
        const db = getDb();

        for (const visit of db.visits) {
            const planned = db.appointmentProcedures.filter(
                (line) => line.appointmentId === visit.appointmentId,
            );
            if (planned.length === 0) continue;

            // Identities, not counts: a visit whose lines are entirely
            // unrelated to its booking satisfies any comparison of lengths,
            // and that is the case this file exists to catch.
            const performed = db.visitProcedures.filter((line) => line.visitId === visit.id);
            const performedIds = performed.map((line) => line.procedureId);
            for (const line of planned) {
                expect(performedIds).toContain(line.procedureId);
            }

            // Check-in adds nothing of its own, so a booked visit carries exactly
            // its plan. A line check-in slipped in again would fail here.
            expect(performed.length).toBe(planned.length);
        }
    });

    // At midday, because the rest of today is placed after now: seeded at 23:50,
    // most of it lands on tomorrow and today holds three rows, which is right
    // for that hour and not what this checks.
    it('draws a day, a register, a catalogue and money', () => {
        setSystemTime(new Date(instantAt('2030-01-15', 12 * 60)));
        setDb(seedDemoDb());

        expect(
            appointmentHandlers.byDate({ date: today(), offsetMinutes: offsetMinutes() }).length,
        ).toBeGreaterThan(3);
        expect(patientHandlers.recent({ limit: 25 }).total).toBeGreaterThan(10);
        expect(procedureHandlers.tree({ includeInactive: false }).length).toBeGreaterThan(4);
        expect(balanceHandlers.outstanding().total).toBeGreaterThan(0);
        expect(
            reminderHandlers.pending({ dueOnly: true, limit: 100, offsetMinutes: 0 }).length,
        ).toBeGreaterThan(0);
    });

    it('keeps opening balances out of the day and inside what is owed', () => {
        const db = getDb();
        const carried = db.appointments.filter((row) => row.isOpeningBalance);
        expect(carried.length).toBeGreaterThan(0);

        const day = appointmentHandlers.byDate({ date: today(), offsetMinutes: offsetMinutes() });
        expect(day.some((row) => row.isOpeningBalance)).toBe(false);

        const owed = balanceHandlers.outstanding();
        const carriedPatients = new Set(carried.map((row) => row.patientId));
        expect(owed.patients.some((row) => carriedPatients.has(row.patientId))).toBe(true);
    });
});

describe('the Patients list, a page at a time', () => {
    it('walks the whole register once, in the order a single page would give', () => {
        const everyone = patientHandlers.recent({ limit: 100 });
        const seen: string[] = [];
        for (let offset = 0; offset < everyone.total; offset += 4) {
            const page = patientHandlers.recent({ limit: 4, offset });
            expect(page.total).toBe(everyone.total);
            seen.push(...page.patients.map((row) => row.id));
        }

        expect(seen).toEqual(everyone.patients.map((row) => row.id));
        expect(patientHandlers.recent({ limit: 4, offset: everyone.total }).patients).toEqual([]);
    });

    it('pages a search the same way', () => {
        const term = getDb().patients[0]?.phone.slice(-2) ?? '';
        const all = patientHandlers.search({ q: term, limit: 100 });
        const paged = [
            ...patientHandlers.search({ q: term, limit: 2 }),
            ...patientHandlers.search({ q: term, limit: 100, offset: 2 }),
        ];

        expect(paged.map((row) => row.id)).toEqual(all.map((row) => row.id));
    });

    it('answers balances for the page asked about only', () => {
        const owing = balanceHandlers.outstanding().patients;
        const first = owing[0];
        if (!first) throw new Error('the seed has nobody owing');

        const page = balanceHandlers.outstanding({ patientIds: [first.patientId] });

        expect(page.patients).toEqual([first]);
        expect(page.total).toBe(first.balance);
        expect(balanceHandlers.outstanding({ patientIds: [] }).patients).toEqual([]);
    });
});

describe('a visit, end to end', () => {
    it('books, checks in, prices and settles', () => {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[3];
        const cleaning = db.procedureTypes.find((row) => row.name === 'Scaling & polishing');
        if (!branch || !patient || !cleaning) throw new Error('the seed is missing its fixtures');

        // Past the six days the seed books ahead, so this cannot land on one of
        // its slots and be refused for a reason the test is not about.
        const startsAt = new Date(Date.now() + 9 * 24 * 3_600_000);

        const appointment = appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: startsAt.toISOString(),
            durationMinutes: 30,
            procedures: [{ procedureId: cleaning.id, quantity: 1 }],
            offsetMinutes: 0,
        });

        expect(appointment.status).toBe('booked');
        expect(appointment.ref).toMatch(/^\d{6}-[A-Z0-9]{4}$/);

        // Check-in is refused off the appointment's own day. Booked clear of the
        // seed's week above, then brought to now by hand for the visit.
        appointment.startsAt = new Date();
        const visit = visitHandlers.checkIn({ appointmentId: appointment.id });
        const detail = visitHandlers.byId({ id: visit.id });

        // The cleaning, and nothing else: check-in adds no consultation.
        expect(detail.procedures).toHaveLength(1);
        expect(detail.chargedTotal).toBe(cleaning.defaultPrice);

        const closed = visitHandlers.checkOut({
            visitId: visit.id,
            chargedTotal: cleaning.defaultPrice,
            paidTotal: 20_000,
            method: 'cash',
        });

        expect(closed.completedAt).toBeInstanceOf(Date);
        expect(closed.balance).toBe(cleaning.defaultPrice - 20_000);

        const settled = balanceHandlers.settle({
            patientId: patient.id,
            amount: closed.balance ?? 0,
            method: 'visa',
        });

        expect(settled.outstandingAfter).toBe(0);
        expect(visitHandlers.byId({ id: visit.id }).balance).toBe(0);
    });

    it('refuses to move an appointment once it is checked in, as the server does', () => {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        if (!branch || !patient) throw new Error('the seed is missing its fixtures');

        const appointment = appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: new Date(Date.now() + 10 * 24 * 3_600_000).toISOString(),
            durationMinutes: 30,
            offsetMinutes: 0,
        });

        // Check-in is refused off the appointment's own day. Booked clear of the
        // seed's week, then brought to now by hand, as the visit above does.
        appointment.startsAt = new Date();
        const startsAt = appointment.startsAt;
        visitHandlers.checkIn({ appointmentId: appointment.id });

        const later = new Date(startsAt.getTime() + 60 * 60_000).toISOString();
        let code: string | undefined;
        try {
            appointmentHandlers.update({ id: appointment.id, startsAt: later });
        } catch (error) {
            code = (error as { code?: string }).code;
        }

        expect(code).toBe('INVALID_STATUS_TRANSITION');
        expect(db.appointments.find((row) => row.id === appointment.id)?.startsAt.getTime()).toBe(
            startsAt.getTime(),
        );
    });

    // The visit editor writes the note onto the appointment, and it is opened
    // on a patient who is already checked in — the one status a move is refused
    // on. A note is not a move, so it lands, and clearing it writes null.
    it('takes a note on a visit that is already checked in, and clears it again', () => {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[2];
        const cleaning = db.procedureTypes.find((row) => row.name === 'Scaling & polishing');
        if (!branch || !patient || !cleaning) throw new Error('the seed is missing its fixtures');

        const appointment = appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: new Date(Date.now() + 11 * 24 * 3_600_000).toISOString(),
            durationMinutes: 30,
            procedures: [{ procedureId: cleaning.id, quantity: 1 }],
            offsetMinutes: 0,
        });

        expect(appointment.note).toBeNull();

        appointment.startsAt = new Date();
        visitHandlers.checkIn({ appointmentId: appointment.id });

        expect(
            appointmentHandlers.update({ id: appointment.id, note: 'Anxious about the drill.' }).note,
        ).toBe('Anxious about the drill.');

        // The plan is untouched by a note-only write: the editor sends the two
        // separately, and an absent `procedures` must not read as an empty one.
        expect(appointmentHandlers.byId({ id: appointment.id }).procedures).toHaveLength(1);

        expect(appointmentHandlers.update({ id: appointment.id, note: null }).note).toBeNull();
    });

    it('empties the chair into the longest wait when the patient goes to the desk', () => {
        const db = getDb();

        const seatedBefore = db.visits.find((visit) => {
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return visit.inChairAt !== null && appointment?.status === 'checked_in';
        });
        if (!seatedBefore) throw new Error('the seed put nobody in the chair');

        const waiting = db.visits
            .filter((visit) => {
                const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
                return visit.inChairAt === null && appointment?.status === 'checked_in';
            })
            .sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime());

        const next = waiting[0];
        if (!next) throw new Error('the seed left nobody waiting');

        appointmentHandlers.awaitPayment({ id: seatedBefore.appointmentId, offsetMinutes: offsetMinutes() });

        // The one who had been waiting longest is now the one in the chair, and
        // their bar starts here rather than at the time they arrived.
        expect(next.inChairAt).toBeInstanceOf(Date);
        expect(next.inChairAt?.getTime()).toBeGreaterThan(next.checkedInAt.getTime());
    });
});

describe('a walk-in, when the queue runs past midnight', () => {
    afterEach(() => {
        setSystemTime();
    });

    // The clock is pinned to a night past anything the seed booked, so the
    // only rows in the way are the two written here, and the test fails the
    // same way whatever time it is run.
    it('pushes a booking already past midnight instead of landing on it', () => {
        setSystemTime(new Date('2030-01-15T23:40:00.000Z'));

        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        const walkUp = db.patients[2];
        if (!branch || !patient || !walkUp) throw new Error('the seed is missing its fixtures');

        const book = (startsAt: string) =>
            appointmentHandlers.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt,
                durationMinutes: 30,
                offsetMinutes: 0,
            });

        const lateTonight = book('2030-01-15T23:50:00.000Z');
        const pastMidnight = book('2030-01-16T00:20:00.000Z');

        appointmentHandlers.walkIn({
            patient: { kind: 'existing', patientId: walkUp.id },
            branchId: branch.id,
            durationMinutes: 30,
            offsetMinutes: 0,
        });

        expect(lateTonight.startsAt.toISOString()).toBe('2030-01-16T00:10:00.000Z');
        expect(pastMidnight.startsAt.toISOString()).toBe('2030-01-16T00:40:00.000Z');
    });
});

describe('the chair, when someone leaves the queue by another door', () => {
    function seated(): number {
        const db = getDb();
        return db.visits.filter((visit) => {
            if (!visit.inChairAt) return false;
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in';
        }).length;
    }

    it('does not seat the next patient off one who never held the chair', () => {
        const db = getDb();

        const waiting = db.visits.find((visit) => {
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in' && visit.inChairAt === null;
        });
        if (!waiting) throw new Error('the seed left nobody waiting');

        expect(seated()).toBe(1);

        // Sending a waiting patient to the desk does not empty the chair, so
        // nothing may be seated off it. Seating anyway leaves two visits
        // answering "in the chair" and the day view drawing two running bars.
        appointmentHandlers.awaitPayment({ id: waiting.appointmentId, offsetMinutes: offsetMinutes() });

        expect(seated()).toBe(1);
    });

    // Deleting the visit in the chair is the third way out of it, and the one
    // where the appointment is rewritten on the way. The handler reads the row
    // it is about to set back to `booked`, so the chair check has to be taken
    // before that — or a desk booking empties the chair and seats nobody.
    it('seats the next patient when the one in the chair is deleted', () => {
        const db = getDb();

        const inChair = db.visits.find((visit) => {
            if (!visit.inChairAt) return false;
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in' && appointment.channel !== 'walk_in';
        });
        if (!inChair) throw new Error('the seed seated nobody on a desk booking');

        const waiting = db.visits.find((visit) => {
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in' && visit.inChairAt === null;
        });
        if (!waiting) throw new Error('the seed left nobody waiting');

        visitHandlers.delete({ visitId: inChair.id, offsetMinutes: offsetMinutes() });

        expect(getDb().visits.find((row) => row.id === inChair.id)).toBeUndefined();
        expect(getDb().visits.find((row) => row.id === waiting.id)?.inChairAt).not.toBeNull();
        // The booking itself survives: they were expected, and whether they
        // came is the desk's to say with cancel or no-show.
        expect(getDb().appointments.find((row) => row.id === inChair.appointmentId)?.status).toBe('booked');
    });

    it('still seats the next patient off the one who did hold it', () => {
        const db = getDb();

        const inChair = db.visits.find((visit) => {
            if (!visit.inChairAt) return false;
            const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
            return appointment?.status === 'checked_in';
        });
        if (!inChair) throw new Error('the seed seated nobody');

        appointmentHandlers.awaitPayment({ id: inChair.appointmentId, offsetMinutes: offsetMinutes() });

        // The chair emptied, so the longest-waiting visit takes it.
        expect(seated()).toBe(1);
        expect(getDb().visits.find((row) => row.id === inChair.id)?.inChairAt).not.toBeNull();
    });

    // The seed books the chair fifty minutes back and the queue around now, so
    // just after midnight UTC the two straddle a UTC date. The clinic's day is
    // what counts, and the app always sends its offset: these tests used to
    // leave it off, fell back to UTC, and failed in CI's first hour of the day.
    it('seats the next patient just after midnight UTC, on the clinic’s day', () => {
        setSystemTime(new Date('2026-10-10T00:20:00.000Z'));
        try {
            setDb(seedDemoDb());
            const db = getDb();
            const inChair = db.visits.find((visit) => {
                if (!visit.inChairAt) return false;
                const appointment = db.appointments.find((row) => row.id === visit.appointmentId);
                return appointment?.status === 'checked_in';
            });
            if (!inChair) throw new Error('the seed seated nobody');

            appointmentHandlers.awaitPayment({ id: inChair.appointmentId, offsetMinutes: offsetMinutes() });

            expect(seated()).toBe(1);
        } finally {
            setSystemTime();
        }
    });
});

describe('the refusals a demo runs into', () => {
    it('refuses a double booking with SLOT_OVERLAP', () => {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        if (!branch || !patient) throw new Error('the seed is missing its fixtures');

        const startsAt = new Date(Date.now() + 10 * 24 * 3_600_000).toISOString();
        const book = () =>
            appointmentHandlers.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt,
                durationMinutes: 30,
                offsetMinutes: 0,
            });

        book();
        expect(book).toThrow(DemoError);

        try {
            book();
        } catch (error) {
            expect((error as InstanceType<typeof DemoError>).code).toBe('SLOT_OVERLAP');
        }
    });

    it('cancels a booking on a future day and lets the same slot be booked again', () => {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        if (!branch || !patient) throw new Error('the seed is missing its fixtures');

        const startsAt = new Date(Date.now() + 10 * 24 * 3_600_000).toISOString();
        const book = () =>
            appointmentHandlers.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt,
                durationMinutes: 30,
                offsetMinutes: 0,
            });

        const first = book();
        expect(appointmentHandlers.cancel({ id: first.id }).status).toBe('cancelled');

        const rebooked = book();
        expect(rebooked.id).not.toBe(first.id);
        expect(rebooked.status).toBe('booked');
    });

    it('refuses a payment larger than the balance', () => {
        const owing = balanceHandlers.outstanding().patients[0];
        if (!owing) throw new Error('the seed left nobody owing');

        expect(() =>
            balanceHandlers.settle({
                patientId: owing.patientId,
                amount: owing.balance + 1,
                method: 'cash',
            }),
        ).toThrow('a payment may not exceed what the patient owes');
    });

    it('refuses a payment of nothing', () => {
        const owing = balanceHandlers.outstanding().patients[0];
        if (!owing) throw new Error('the seed left nobody owing');

        // The demo link hands the handler its input with none of the router's
        // schema in front of it, so the bound is this handler's to hold. Zero
        // would otherwise write no payment row and still report a balance the
        // stored rows do not produce.
        for (const amount of [0, -500]) {
            expect(() =>
                balanceHandlers.settle({ patientId: owing.patientId, amount, method: 'cash' }),
            ).toThrow(DemoError);
        }
    });

    it('refuses a tooth on a procedure that is not done on one', () => {
        const db = getDb();
        const cleaning = db.procedureTypes.find((row) => row.name === 'Scaling & polishing');
        // An open visit: a closed one is refused earlier, for a different reason.
        const visit = db.visits.find((row) => row.completedAt === null);
        if (!cleaning || !visit) throw new Error('the seed is missing its fixtures');

        expect(() =>
            visitHandlers.setProcedures({
                visitId: visit.id,
                procedures: [{ procedureId: cleaning.id, quantity: 1, tooth: 'UL6' }],
            }),
        ).toThrow('that procedure is not done on a specific tooth');
    });
});

describe('what the clinic requires on a patient', () => {
    function codeOf(run: () => unknown): string | null {
        try {
            run();
            return null;
        } catch (error) {
            return (error as InstanceType<typeof DemoError>).code;
        }
    }

    const register = (details: { birthDate?: string | null; gender?: string | null }) =>
        patientHandlers.create({
            name: 'Nadia Hassan',
            phone: '01012345678',
            // The seed's one required question, so the questionnaire is not what refuses.
            custom: { diabetic: false },
            ...details,
        });

    const book = (details: { birthDate?: string | null; gender?: string | null }) => {
        const branch = getDb().branches[0];
        if (!branch) throw new Error('the seed is missing its fixtures');
        return appointmentHandlers.create({
            patient: { kind: 'new', name: 'Walk-up Wael', phone: '01099999999', ...details },
            branchId: branch.id,
            startsAt: new Date(Date.now() + 12 * 24 * 3_600_000).toISOString(),
            durationMinutes: 30,
            offsetMinutes: 0,
        });
    };

    it('by default refuses a patient without an age, and takes one without a sex', () => {
        expect(settingsHandlers.get()).toMatchObject({ requireAge: true, requireGender: false });
        expect(codeOf(() => register({}))).toBe('AGE_REQUIRED');
        expect(codeOf(() => book({ birthDate: null }))).toBe('AGE_REQUIRED');
        expect(register({ birthDate: '1990-01-01' }).gender).toBeNull();
    });

    it('with age off, registers, books and clears an age', () => {
        settingsHandlers.update({ requireAge: false });

        const created = register({});
        expect(created.age).toBeNull();
        expect(codeOf(() => book({}))).toBeNull();

        const aged = patientHandlers.update({ id: created.id, birthDate: '1990-01-01' });
        expect(aged.age).not.toBeNull();
        expect(patientHandlers.update({ id: created.id, birthDate: null }).birthDate).toBeNull();
    });

    it('with sex on, refuses to register, book or clear without one', () => {
        settingsHandlers.update({ requireGender: true });

        expect(codeOf(() => register({ birthDate: '1990-01-01' }))).toBe('GENDER_REQUIRED');
        expect(codeOf(() => book({ birthDate: '1990-01-01', gender: ' ' }))).toBe('GENDER_REQUIRED');

        const created = register({ birthDate: '1990-01-01', gender: 'female' });
        expect(codeOf(() => patientHandlers.update({ id: created.id, gender: null }))).toBe(
            'GENDER_REQUIRED',
        );
        expect(codeOf(() => patientHandlers.update({ id: created.id, birthDate: null }))).toBe(
            'AGE_REQUIRED',
        );
    });

    it('turned on, still edits a seeded patient who has no age', () => {
        const ageless = getDb().patients.find((row) => row.birthDate === null);
        if (!ageless) throw new Error('the seed has nobody without an age');

        expect(patientHandlers.update({ id: ageless.id, notes: 'Prefers mornings' }).age).toBeNull();
    });
});

describe('moving an appointment', () => {
    function fixtures() {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        const procedure = db.procedureTypes.find((row) => row.name === 'Scaling & polishing');
        if (!branch || !patient || !procedure) throw new Error('the seed is missing its fixtures');
        return { db, branch, patient, procedure };
    }

    it('keeps the ref, plan and note, and takes the reminder with it', () => {
        const { db, branch, patient, procedure } = fixtures();
        const { reminderLeadHours } = settingsHandlers.get();
        const startsAt = new Date(Date.now() + 12 * 24 * 3_600_000);

        const booked = appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: startsAt.toISOString(),
            durationMinutes: 30,
            procedures: [{ procedureId: procedure.id }],
            note: 'Sensitive on the left',
            offsetMinutes: 0,
        });
        const ref = booked.ref;
        expect(db.reminders.some((row) => row.appointmentId === booked.id)).toBe(true);

        // Into its own span: the row does not clash with itself.
        const later = new Date(startsAt.getTime() + 15 * 60_000);
        const moved = appointmentHandlers.update({ id: booked.id, startsAt: later.toISOString() });

        expect(moved.id).toBe(booked.id);
        expect(moved.startsAt.getTime()).toBe(later.getTime());
        expect(moved.ref).toBe(ref);
        expect(moved.note).toBe('Sensitive on the left');
        expect(moved.status).toBe('booked');
        expect(
            db.appointmentProcedures
                .filter((line) => line.appointmentId === booked.id)
                .map((line) => line.procedureId),
        ).toEqual([procedure.id]);

        const reminder = db.reminders.find((row) => row.appointmentId === booked.id);
        expect(reminder?.dueAt.getTime()).toBe(later.getTime() - reminderLeadHours * 3_600_000);
    });

    // As the server: a quote is kept per line, a plan sent without it follows
    // the catalogue again, and check-in bills whichever the line holds.
    it('keeps a quoted price through a repricing and bills it at check-in', () => {
        const { db, branch, patient, procedure } = fixtures();
        const startsAt = new Date(Date.now() + 14 * 24 * 3_600_000);

        const booked = appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: startsAt.toISOString(),
            durationMinutes: 30,
            procedures: [{ procedureId: procedure.id }],
            offsetMinutes: 0,
        });
        const quoteOf = () =>
            appointmentHandlers.byId({ id: booked.id }).procedures.map((line) => line.quotedPrice);
        expect(quoteOf()).toEqual([null]);

        appointmentHandlers.update({
            id: booked.id,
            procedures: [{ procedureId: procedure.id, quotedPrice: 12_300 }],
        });
        expect(quoteOf()).toEqual([12_300]);

        appointmentHandlers.update({ id: booked.id, note: 'moved rooms' });
        expect(quoteOf()).toEqual([12_300]);

        // Brought to now by hand: check-in is refused off the appointment's day.
        const row = db.appointments.find((candidate) => candidate.id === booked.id);
        if (!row) throw new Error('the booking went missing');
        row.startsAt = new Date();
        const visit = visitHandlers.checkIn({ appointmentId: booked.id });
        expect(visitHandlers.byId({ id: visit.id }).procedures.map((line) => line.unitPrice)).toEqual([
            12_300,
        ]);
    });

    it('refuses a move onto another booking with SLOT_OVERLAP', () => {
        const { branch, patient } = fixtures();
        const startsAt = new Date(Date.now() + 13 * 24 * 3_600_000);
        const book = (at: Date) =>
            appointmentHandlers.create({
                patient: { kind: 'existing', patientId: patient.id },
                branchId: branch.id,
                startsAt: at.toISOString(),
                durationMinutes: 30,
                offsetMinutes: 0,
            });

        book(startsAt);
        const second = book(new Date(startsAt.getTime() + 60 * 60_000));

        try {
            appointmentHandlers.update({ id: second.id, startsAt: startsAt.toISOString() });
            throw new Error('the move was not refused');
        } catch (error) {
            expect((error as InstanceType<typeof DemoError>).code).toBe('SLOT_OVERLAP');
        }
    });
});

describe('the dispatch table', () => {
    it('answers every procedure the app can call', () => {
        // A spot check that the table is wired to real functions rather than a
        // shape that merely typechecks.
        expect(hasHandler('appointment.byDate')).toBe(true);
        expect(hasHandler('visit.checkOut')).toBe(true);
        expect(hasHandler('nope.missing')).toBe(false);

        // Inherited members are not procedures. Answering `true` here would
        // have `resolve` call the prototype method and return its value, where
        // `link.ts` is expecting the refusal it turns into NOT_FOUND.
        expect(hasHandler('toString')).toBe(false);
        expect(hasHandler('constructor')).toBe(false);

        const report = resolve(
            'stats.summary',
            { from: today(), to: today(), offsetMinutes: offsetMinutes() },
            { token: null, deviceId: null, role: null },
        );

        expect(report).toMatchObject({ appointments: { total: expect.any(Number) } });
    });

    it('reports the day the stats screen asks for', () => {
        const summary = statsHandlers.summary({
            from: today(),
            to: today(),
            offsetMinutes: offsetMinutes(),
        });

        expect(summary.appointments.total).toBeGreaterThan(0);
        expect(summary.visits.outstanding).toBeGreaterThan(0);
    });
});

/**
 * The lead time is retroactive on the server, so it has to be here too: a demo
 * that shortened "Remind before" and watched nothing move would be showing the
 * bug the real backend no longer has.
 */
describe('changing the reminder lead time', () => {
    function book(daysAway: number) {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        if (!branch || !patient) throw new Error('the seed is missing its fixtures');

        return appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: new Date(Date.now() + daysAway * 24 * 3_600_000).toISOString(),
            durationMinutes: 30,
            offsetMinutes: 0,
        });
    }

    function reminderFor(appointmentId: string) {
        const row = getDb().reminders.find((reminder) => reminder.appointmentId === appointmentId);
        if (!row) throw new Error('expected a reminder');
        return row;
    }

    it('moves the reminders already booked', () => {
        const booked = book(20);

        settingsHandlers.update({ reminderLeadHours: 6 });

        expect(reminderFor(booked.id).dueAt.getTime()).toBe(booked.startsAt.getTime() - 6 * 3_600_000);
    });

    it('leaves a reminder that is no longer pending', () => {
        const booked = book(21);
        const reminder = reminderFor(booked.id);
        reminderHandlers.markSent({ id: reminder.id });
        const untouched = reminder.dueAt.getTime();

        settingsHandlers.update({ reminderLeadHours: 6 });

        expect(reminderFor(booked.id).dueAt.getTime()).toBe(untouched);
    });

    it('leaves every reminder when some other setting is the one being saved', () => {
        const booked = book(22);
        const untouched = reminderFor(booked.id).dueAt.getTime();

        settingsHandlers.update({ reminderTemplate: 'See you {{date}}.' });

        expect(reminderFor(booked.id).dueAt.getTime()).toBe(untouched);
    });
});

/** As `packages/server/tests/lab-status.test.ts`. */
describe('lab work', () => {
    let daysAway = 23;

    function book(needsLab?: boolean) {
        daysAway += 1;
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        if (!branch || !patient) throw new Error('the seed is missing its fixtures');

        return appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: new Date(Date.now() + daysAway * 24 * 3_600_000).toISOString(),
            durationMinutes: 30,
            needsLab,
            offsetMinutes: 0,
        });
    }

    function reminderOf(appointmentId: string) {
        return reminderHandlers
            .pending({ dueOnly: false, limit: 200, offsetMinutes: 0 })
            .find((row) => row.appointmentId === appointmentId);
    }

    it('books without a lab unless asked', () => {
        expect(book().labStatus).toBeNull();
        expect(book(true).labStatus).toBe('pending');
    });

    it('switches on and off, and keeps work that is already back', () => {
        const booked = book();

        expect(appointmentHandlers.update({ id: booked.id, needsLab: true }).labStatus).toBe('pending');
        expect(appointmentHandlers.markLabReady({ id: booked.id }).labStatus).toBe('ready');
        expect(appointmentHandlers.update({ id: booked.id, needsLab: true }).labStatus).toBe('ready');
        expect(appointmentHandlers.update({ id: booked.id, needsLab: false }).labStatus).toBeNull();
    });

    it('marks ready only what is pending', () => {
        expect(appointmentHandlers.markLabReady({ id: book().id }).labStatus).toBeNull();
    });

    it('puts the lab status on the reminder', () => {
        const booked = book(true);
        expect(reminderOf(booked.id)?.labStatus).toBe('pending');

        appointmentHandlers.markLabReady({ id: booked.id });
        expect(reminderOf(booked.id)?.labStatus).toBe('ready');
    });

    it('seeds a crown still at the lab', () => {
        expect(getDb().appointments.some((row) => row.labStatus === 'pending')).toBe(true);
    });
});

/**
 * The demo sends nothing, but it renders the same message the server does, and
 * it is the backend a demo walks the settings pane against. It substituted the
 * double-brace tokens while the pane's chips inserted single ones, so a demo
 * built a template from the chips and previewed braces it could not resolve.
 * Both senders now share `renderReminderTemplate`; this holds the demo to it.
 */
describe('the reminder message the demo renders', () => {
    function firstPending() {
        const [reminder] = reminderHandlers.pending({ dueOnly: false, limit: 100, offsetMinutes: 0 });
        if (!reminder) throw new Error('expected a pending reminder');
        return reminder;
    }

    it('substitutes the time chip into the message and the WhatsApp link', () => {
        settingsHandlers.update({ reminderTemplate: 'Be here at {{time}}.' });

        const reminder = firstPending();
        const expected = `Be here at ${reminder.startsAt.toISOString().slice(11, 16)}.`;

        expect(reminder.message).toBe(expected);
        expect(new URL(reminder.whatsAppUrl).searchParams.get('text')).toBe(expected);
        expect(reminder.whatsAppUrl).not.toContain('%7B');
    });

    it('encodes the message so the WhatsApp link carries all of it', () => {
        settingsHandlers.update({
            clinicName: 'Smile & Co #1 + Kids',
            reminderTemplate: 'موعدك الساعة {{time}}\n{{clinic}} 100%?',
        });

        const reminder = firstPending();
        const url = new URL(reminder.whatsAppUrl);

        expect([...url.searchParams.keys()]).toEqual(['text']);
        expect(url.hash).toBe('');
        expect(url.searchParams.get('text')).toBe(reminder.message);
        expect(reminder.message).toBe(
            `موعدك الساعة ${reminder.startsAt.toISOString().slice(11, 16)}\nSmile & Co #1 + Kids 100%?`,
        );
    });

    it('resolves every chip the settings pane offers', () => {
        settingsHandlers.update({ reminderTemplate: REMINDER_TOKENS.join(' ') });

        expect(firstPending().message).not.toMatch(/[{}]/);
    });

    it('names the branch the appointment is at', () => {
        settingsHandlers.update({ reminderTemplate: 'See you at {{branch}}.' });

        const reminder = firstPending();
        const appointment = getDb().appointments.find((row) => row.id === reminder.appointmentId);
        const branch = getDb().branches.find((row) => row.id === appointment?.branchId);

        expect(branch?.name).toBeTruthy();
        expect(reminder.message).toBe(`See you at ${branch?.name}.`);
    });

    // A demo database seeded before the chips were fixed still holds one.
    it('still resolves a template saved in the old single braces', () => {
        settingsHandlers.update({ reminderTemplate: 'See you at {time}.' });

        const reminder = firstPending();

        expect(reminder.message).toBe(`See you at ${reminder.startsAt.toISOString().slice(11, 16)}.`);
    });

    it('sends the seeded default with no braces left in it', () => {
        expect(firstPending().message).not.toMatch(/[{}]/);
    });
});

describe('roles', () => {
    const { admit, shownTo } = accessModule;

    function paidVisit() {
        const db = getDb();
        const payment = db.payments[0];
        const visit = db.visits.find((row) => row.id === payment?.visitId);
        const appointment = db.appointments.find((row) => row.id === visit?.appointmentId);
        if (!visit || !appointment) throw new Error('the seed has no paid visit');
        return { visit, patientId: appointment.patientId };
    }

    function as(role: 'admin' | 'doctor' | 'secretary') {
        return provisionDemo(role, null).token;
    }

    it('refuses a doctor every payment procedure, as the server does', () => {
        const token = as('doctor');
        for (const path of ['balance.outstanding', 'balance.settle', 'stats.summary', 'visit.setPaid']) {
            expect(() => admit(path, token)).toThrow(DemoError);
        }
        expect(admit('visit.checkOut', token).role).toBe('doctor');
    });

    it('shows a doctor a finished visit’s procedures, and no charge, price or payment', () => {
        const { visit, patientId } = paidVisit();
        const caller = admit('visit.byId', as('doctor'));

        const read = shownTo('visit.byId', visitHandlers.byId({ id: visit.id }), caller) as {
            chargedTotal: unknown;
            payments: unknown;
            procedures: { unitPrice: unknown }[];
        };
        expect(read.chargedTotal).toBeNull();
        expect(read.payments).toBeNull();
        expect(read.procedures.every((line) => line.unitPrice === null)).toBe(true);

        const record = shownTo('patient.byId', patientHandlers.byId({ id: patientId }), caller) as {
            history: { completedAt: unknown; chargedTotal: unknown; paidTotal: unknown }[];
        };
        expect(record.history.every((entry) => entry.paidTotal === null)).toBe(true);
        const finished = record.history.filter((entry) => entry.completedAt !== null);
        expect(finished.every((entry) => entry.chargedTotal === null)).toBe(true);
    });

    it('does not let a doctor reopen a finished visit, or set the clinic up', () => {
        const token = as('doctor');
        expect(() => admit('visit.reopen', token)).toThrow(DemoError);
        expect(() => admit('procedure.update', token)).toThrow(DemoError);
        expect(() => admit('settings.update', token, { clinicName: 'Mine' })).toThrow(DemoError);
        expect(admit('settings.update', token, { reminderLeadHours: 12 }).role).toBe('doctor');
        expect(admit('procedure.update', as('admin')).role).toBe('admin');
    });

    it('leaves the secretary and a phone with no role everything', () => {
        const { visit } = paidVisit();
        for (const token of [as('secretary'), null]) {
            const caller = admit('visit.byId', token);
            const read = shownTo('visit.byId', visitHandlers.byId({ id: visit.id }), caller) as {
                payments: unknown;
            };
            expect(read.payments).not.toBeNull();
        }
    });

    it('turns a phone with no role away once provisioning is required', () => {
        getDb().settings.requireProvisioning = true;
        expect(() => admit('settings.get', null)).toThrow(DemoError);
        expect(admit('device.redeem', null).role).toBeNull();
    });

    it('lets only the admin issue codes, and a revoked phone nothing at all', () => {
        const admin = admit('device.issue', as('admin'));
        expect(() => admit('device.issue', as('secretary'))).toThrow(DemoError);

        const issued = resolve('device.issue', { role: 'doctor', label: 'Surgery' }, admin) as {
            id: string;
            payload: string;
        };
        const code = issued.payload.split(':').pop() ?? '';
        const doctor = resolve('device.redeem', { code }, { token: null, deviceId: null, role: null }) as {
            token: string;
        };
        resolve('device.revoke', { grantId: issued.id }, admin);

        expect(() => admit('settings.get', doctor.token)).toThrow(DemoError);
    });
});

/**
 * As `packages/server/tests/reminder-cutoff.test.ts`: from the notify time the
 * due list is the rest of the clinic day, and the arm counts that list from the
 * morning so the notify time is not left silent.
 */
describe('the reminders due from the notify time', () => {
    const HOUR = 3_600_000;
    // Past the seed's appointments and the other describes' bookings.
    const DAY = (() => {
        const at = new Date();
        at.setUTCDate(at.getUTCDate() + 40);
        at.setUTCHours(0, 0, 0, 0);
        return at.getTime();
    })();
    const onDay = (hours: number) => new Date(DAY + hours * HOUR);

    let morning = '';
    let evening = '';
    let booked: string[] = [];

    function book(startsAt: Date): string {
        const db = getDb();
        const branch = db.branches[0];
        const patient = db.patients[1];
        if (!branch || !patient) throw new Error('the seed is missing its fixtures');

        return appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient.id },
            branchId: branch.id,
            startsAt: startsAt.toISOString(),
            durationMinutes: 30,
            offsetMinutes: 0,
        }).id;
    }

    function dueAt(now: Date, input: { offsetMinutes: number; throughToday?: boolean }): string[] {
        setSystemTime(now);
        try {
            return reminderHandlers
                .pending({ dueOnly: true, limit: 200, ...input })
                .map((row) => row.appointmentId)
                .filter((id) => booked.includes(id));
        } finally {
            setSystemTime();
        }
    }

    beforeEach(() => {
        settingsHandlers.update({ reminderLeadHours: 24, reminderNotifyAt: '17:00' });
        for (const reminder of getDb().reminders) reminder.status = 'skipped';
        // Due today at 10:00 and 20:00, and tomorrow at 01:00.
        morning = book(onDay(24 + 10));
        evening = book(onDay(24 + 20));
        booked = [morning, evening, book(onDay(48 + 1))];
    });

    afterEach(() => {
        setSystemTime();
    });

    it('lists only what is due by now before the notify time', () => {
        expect(dueAt(onDay(11), { offsetMinutes: 0 })).toEqual([morning]);
    });

    it('lists the rest of the day from the notify time, and stops at midnight', () => {
        expect(dueAt(onDay(17), { offsetMinutes: 0 })).toEqual([morning, evening]);
    });

    it('reads the day from offsetMinutes', () => {
        expect(dueAt(onDay(13 + 59 / 60), { offsetMinutes: 180 })).toEqual([morning]);
        expect(dueAt(onDay(14), { offsetMinutes: 180 })).toEqual([morning, evening]);
    });

    it('arms the notify time from the morning, before anything is due', () => {
        expect(dueAt(onDay(9), { offsetMinutes: 0 })).toEqual([]);

        const pendingCount = dueAt(onDay(9), nudgePendingInput(0)).length;
        expect(pendingCount).toBe(2);

        const plan = planNudges({
            notifyAt: 17 * 60,
            repeatMinutes: 30,
            pendingCount,
            dismissedOn: null,
            today: '2026-09-28',
            now: instantAt('2026-09-28', 9 * 60),
        });
        expect(plan.silent).toBe('pending');
        expect(plan.at[0]).toEqual(new Date(instantAt('2026-09-28', 17 * 60)));
    });
});
