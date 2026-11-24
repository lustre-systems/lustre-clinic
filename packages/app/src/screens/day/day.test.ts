import { describe, expect, it } from 'bun:test';
import { type AppointmentStatus, COPY_AR, ERROR_CODE, type Tooth } from '@lustre/shared';
import { computeTotal } from '../../api/demo/rules';
import { setRuntimeLocale } from '../../i18n/runtime';
import { procedureLabel, rowSummary, splitDay } from './agenda';
import {
    daysOffered,
    firstFreeSlot,
    fortnightSlots,
    type Slot,
    settleBookingDay,
    slotIsFree,
    slotsFor,
    timeLabel,
    withoutAppointment,
    workingDaysIn,
} from './booking';
import { slotProgress, splitDeskDay, splitDoctorDay, standingFor } from './chair';
import { RequestError } from './data/client';
import type { Appointment, Patient, ProcedureCategory } from './data/types';
import { dayDelay, delayLabel, isProjected, ON_TIME, projectedStart } from './delay';
import { emptyDay } from './empty';
import { describeError } from './errors';
import { hoursFor, isClosed, openMinutes } from './hours';
import {
    amountDue,
    discountPercent,
    formatAmount,
    formatMoney,
    poundsEntry,
    procedureDiscount,
} from './money';
import { busiestBranch, loadsFrom } from './month';
import { noteChanged, noteDraft, noteValue } from './notes';
import {
    birthDateDigits,
    birthDateDisplay,
    birthDateError,
    birthDateIso,
    draftFor,
    EMPTY_PATIENT_DRAFT,
    emailError,
    patientRefOf,
} from './patientDraft';
import {
    asksTooth,
    bookedProcedures,
    type ChargeableLine,
    chargeableTotal,
    checkupIsWaived,
    describeProcedure,
    groupByTooth,
    offeredFor,
    type PlannedProcedure,
    planFrom,
    QUADRANTS,
    repriced,
    samePlan,
    toothPosition,
    totalOf,
    withoutTeeth,
} from './procedures';
import {
    addDays,
    clock12,
    clockToMinutes,
    dateKey,
    formatDatePill,
    formatElapsed,
    formatLongDate,
    isoAt,
    minutesOfDay,
    relativeDayLabel,
    secondsOfDay,
} from './time';

const FRIDAY = '2026-08-07';
const SATURDAY = '2026-08-08';

describe('clinic hours', () => {
    it('falls back to the defaults when the clinic has never set a schedule', () => {
        expect(hoursFor(SATURDAY, undefined)).toEqual({ opens: 600, closes: 1320 });
        expect(hoursFor(SATURDAY, [])).toEqual({ opens: 600, closes: 1320 });
    });

    it('closes the default rest day', () => {
        expect(isClosed(FRIDAY, undefined)).toBe(true);
        expect(openMinutes(FRIDAY, undefined)).toBe(0);
    });

    it('lets a saved schedule win, and a missing weekday means closed', () => {
        const schedule = [{ weekday: 5, branchId: 'b', opensAt: '09:00', closesAt: '13:00' }];

        expect(hoursFor(FRIDAY, schedule)).toEqual({ opens: 540, closes: 780 });
        expect(isClosed(SATURDAY, schedule)).toBe(true);
    });
});

describe('the agenda', () => {
    const at = (id: string, time: string, status: AppointmentStatus): Appointment =>
        ({
            id,
            startsAt: `2026-08-10T${time}:00+03:00`,
            status,
            durationMinutes: 30,
            patient: { id: `p-${id}`, name: id, phone: '' },
        }) as Appointment;

    it('folds away what is settled and keeps what still needs doing', () => {
        const { past, upcoming } = splitDay(
            [
                at('done', '09:30', 'done'),
                at('missed', '10:00', 'no_show'),
                at('stale', '10:45', 'booked'),
                at('later', '13:00', 'booked'),
            ],
            null,
        );

        expect(past.map((row) => row.id)).toEqual(['done', 'missed']);
        expect(upcoming.map((row) => row.id)).toEqual(['stale', 'later']);
    });

    it('folds nothing off today, and still puts the day in order', () => {
        const { past, upcoming } = splitDay(
            [at('later', '13:00', 'done'), at('done', '09:30', 'done'), at('missed', '10:00', 'no_show')],
            null,
            false,
        );

        expect(past).toEqual([]);
        expect(upcoming.map((row) => row.id)).toEqual(['done', 'missed', 'later']);
    });

    it('does not draw the patient in the chair twice', () => {
        const { upcoming } = splitDay(
            [at('chair', '11:00', 'checked_in'), at('next', '11:30', 'booked')],
            'chair',
        );
        expect(upcoming.map((row) => row.id)).toEqual(['next']);
    });

    it('puts the day in order whatever order it arrived in', () => {
        const { upcoming } = splitDay([at('b', '13:00', 'booked'), at('a', '09:00', 'booked')], null);
        expect(upcoming.map((row) => row.id)).toEqual(['a', 'b']);
    });

    it('labels a row with every procedure the booking planned', () => {
        const planned = (...names: string[]): Appointment =>
            ({
                ...at('x', '09:00', 'booked'),
                procedures: names.map((name, i) => ({
                    id: `l-${i}`,
                    procedureId: `p-${i}`,
                    name,
                    quantity: 1,
                    tooth: null,
                    note: null,
                })),
            }) as Appointment;

        expect(procedureLabel(planned('Consultation'))).toBe('Consultation');
        expect(procedureLabel(planned('Consultation', 'Zirconia crown'))).toBe(
            'Consultation · Zirconia crown',
        );
        expect(procedureLabel(planned())).toBeUndefined();
    });
});

describe('the visit note', () => {
    const with_ = (note: string | null): Appointment =>
        ({
            id: 'n',
            startsAt: '2026-08-10T09:00:00+03:00',
            status: 'booked',
            durationMinutes: 30,
            note,
            procedures: [
                { id: 'l-0', procedureId: 'p-0', name: 'Consultation', quantity: 1, tooth: null, note: null },
            ],
            patient: { id: 'p-n', name: 'Nadia', phone: '' },
        }) as Appointment;

    it('opens the field on the note the booking left', () => {
        expect(noteDraft('Bring the X-rays.')).toBe('Bring the X-rays.');
        expect(noteDraft(null)).toBe('');
        expect(noteDraft(undefined)).toBe('');
    });

    it('sends a cleared field as no note at all', () => {
        expect(noteValue('')).toBeNull();
        expect(noteValue('   \n ')).toBeNull();
        expect(noteValue('  Bring the X-rays.  ')).toBe('Bring the X-rays.');
    });

    it('writes only what the edit changed', () => {
        expect(noteChanged('Bring the X-rays.', 'Bring the X-rays.')).toBe(false);
        expect(noteChanged('Bring the X-rays.', '  Bring the X-rays. ')).toBe(false);
        expect(noteChanged(null, '')).toBe(false);
        expect(noteChanged(null, '   ')).toBe(false);
        expect(noteChanged(' Bring the X-rays. ', ' Bring the X-rays. ')).toBe(false);

        expect(noteChanged(null, 'Anxious about the drill.')).toBe(true);
        expect(noteChanged('Bring the X-rays.', 'Bring the panoramic.')).toBe(true);
        expect(noteChanged('Bring the X-rays.', '')).toBe(true);
        expect(noteValue('')).toBeNull();
    });

    it('says the note on the row where there is one, and the plan where there is not', () => {
        expect(rowSummary(with_('Bring the X-rays.'))).toBe('Bring the X-rays.');
        expect(rowSummary(with_(null))).toBe('Consultation');
        expect(rowSummary(with_('   '))).toBe('Consultation');
    });
});

describe("the doctor's day", () => {
    const at = (id: string, time: string, status: AppointmentStatus, updatedAt = time): Appointment =>
        ({
            id,
            startsAt: `2026-08-10T${time}:00+03:00`,
            updatedAt: `2026-08-10T${updatedAt}:00+03:00`,
            status,
            durationMinutes: 30,
            patient: { id: `p-${id}`, name: id, phone: '' },
        }) as Appointment;

    const arrivals = (pairs: Record<string, string>) =>
        new Map(Object.entries(pairs).map(([id, time]) => [id, `2026-08-10T${time}:00+03:00`]));

    it('seats whoever checked in first and leaves the rest waiting', () => {
        const day = splitDoctorDay(
            [at('second', '11:35', 'checked_in'), at('first', '11:05', 'checked_in')],
            arrivals({ first: '11:02', second: '11:20' }),
        );

        expect(day.chair?.id).toBe('first');
        expect(day.waiting.map((row) => row.id)).toEqual(['second']);
    });

    it('gives the card to the patient waiting and the strip to the chair', () => {
        const day = splitDoctorDay(
            [
                at('chair', '11:05', 'checked_in'),
                at('waiting', '11:35', 'checked_in'),
                at('booked', '12:00', 'booked'),
            ],
            arrivals({ chair: '11:02', waiting: '11:20' }),
        );

        expect(day.headline?.id).toBe('waiting');
        expect(day.strip?.id).toBe('chair');
        expect(day.list.map((row) => row.id)).toEqual(['booked']);
    });

    it('puts the next slot on the card while the chair keeps the strip', () => {
        const day = splitDoctorDay(
            [at('chair', '11:05', 'checked_in'), at('booked', '12:00', 'booked')],
            arrivals({ chair: '11:02' }),
        );

        expect(day.headline?.id).toBe('booked');
        expect(day.strip?.id).toBe('chair');
        expect(day.list).toEqual([]);
    });

    it('hands the card back to the chair when there is nothing after it', () => {
        const day = splitDoctorDay([at('chair', '11:05', 'checked_in')], arrivals({ chair: '11:02' }));

        expect(day.headline?.id).toBe('chair');
        expect(day.strip).toBeNull();
    });

    it('orders the queue by updatedAt when the visits are not to hand', () => {
        const day = splitDoctorDay([
            at('late', '11:05', 'checked_in', '11:30'),
            at('early', '11:35', 'checked_in', '11:10'),
        ]);

        expect(day.chair?.id).toBe('early');
    });

    it('folds a patient sent to the desk away with the rest of the history', () => {
        const day = splitDoctorDay([
            at('paid', '09:30', 'done'),
            at('desk', '10:00', 'awaiting_payment'),
            at('booked', '12:00', 'booked'),
        ]);

        expect(day.past.map((row) => row.id)).toEqual(['paid', 'desk']);
        expect(day.list).toEqual([]);
        expect(day.headline?.id).toBe('booked');
    });

    it('seats the same patient the desk does', () => {
        const rows = [at('second', '11:35', 'checked_in'), at('first', '11:05', 'checked_in')];
        const when = arrivals({ first: '11:02', second: '11:20' });

        expect(splitDeskDay(rows, when).chair?.id).toBe(splitDoctorDay(rows, when).chair?.id);
    });

    it('holds the desk card on the patient who still owes, and seats the next', () => {
        const day = splitDeskDay(
            [
                at('desk', '11:05', 'awaiting_payment', '11:40'),
                at('waiting', '11:35', 'checked_in'),
                at('booked', '12:00', 'booked'),
            ],
            arrivals({ waiting: '11:20' }),
        );

        expect(day.card?.id).toBe('desk');
        expect(day.chair?.id).toBe('waiting');
    });

    it('falls back to the chair, then to the next booking, for the card', () => {
        const seated = [at('chair', '11:05', 'checked_in'), at('booked', '12:00', 'booked')];

        expect(splitDeskDay(seated, arrivals({ chair: '11:02' })).card?.id).toBe('chair');
        expect(splitDeskDay([at('booked', '12:00', 'booked')]).card?.id).toBe('booked');
        expect(splitDeskDay([at('paid', '09:30', 'done')]).card).toBeNull();
    });

    it('calls an unsettled visit from another day finished, not at the desk', () => {
        const old = at('old', '11:05', 'awaiting_payment');

        expect(standingFor(old, '2026-08-10')).toBe('desk');
        expect(standingFor(old, '2026-08-27')).toBe('finished');
    });

    it('calls a closed visit finished whatever day it is read on', () => {
        expect(standingFor(at('closed', '11:05', 'done'), '2026-08-10')).toBe('finished');
    });

    const stamp = (time: string, seconds = 0) =>
        `2026-08-10T${time}:${String(seconds).padStart(2, '0')}+03:00`;

    it('runs the booked duration from the check-in, not the booked start', () => {
        const appointment = at('chair', '12:00', 'checked_in');
        const seated = minutesOfDay(stamp('08:47'));

        expect(slotProgress(appointment, seated, stamp('08:47')).label).toBe('0:00 / 30 min');
        expect(slotProgress(appointment, seated + 15, stamp('08:47')).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, seated + 15, stamp('08:47')).value).toBe(0.5);
    });

    it('never lets an early arrival stretch the denominator', () => {
        const appointment = at('chair', '12:00', 'checked_in');
        const seated = minutesOfDay(stamp('08:47'));

        expect(slotProgress(appointment, seated, stamp('08:47')).label).toBe('0:00 / 30 min');
        expect(slotProgress(appointment, seated, stamp('08:47')).label).not.toContain('223');
    });

    it('gives a patient seated late their full slot', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = minutesOfDay(stamp('11:30'));

        expect(slotProgress(appointment, seated + 15, stamp('11:30')).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, seated + 15, stamp('11:30')).over).toBe(false);
    });

    it('says so once the visit runs over', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = minutesOfDay(stamp('11:00'));

        expect(slotProgress(appointment, seated + 15, stamp('11:00')).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, seated + 45, stamp('11:00')).over).toBe(true);
        expect(slotProgress(appointment, seated + 45, stamp('11:00')).label).toBe('15:00 over');
    });

    it('falls back to the booked slot with no check-in to hand', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const start = minutesOfDay(appointment.startsAt);

        expect(slotProgress(appointment, start - 193).label).toBe('0:00 / 30 min');
        expect(slotProgress(appointment, start + 15).label).toBe('15:00 / 30 min');
        expect(slotProgress(appointment, start + 15).window).toBe(
            slotProgress(appointment, start + 15, stamp('08:47')).window,
        );
    });

    it('reads a long slot in hours and minutes', () => {
        const appointment = { ...at('chair', '11:00', 'checked_in'), durationMinutes: 90 };
        const seated = minutesOfDay(stamp('11:00'));

        expect(slotProgress(appointment, seated + 45, stamp('11:00')).label).toBe('45:00 / 1h 30m');
        expect(slotProgress(appointment, seated + 75, stamp('11:00')).label).toBe('1:15:00 / 1h 30m');
        expect(slotProgress(appointment, seated + 153, stamp('11:00')).label).toBe('1:03:00 over');
    });

    it('never skips a second, over a run long enough to catch the float', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('10:47', 23);
        const from = secondsOfDay(seated);

        for (let second = 0; second <= 600; second += 1) {
            const nowMinutes = (from + second) / 60;
            expect(slotProgress(appointment, nowMinutes, seated).count).toBe(formatElapsed(second));
        }
    });

    it('advances by exactly one second per second', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('10:47', 23);
        const from = secondsOfDay(seated);

        const counts = Array.from(
            { length: 300 },
            (_, second) => slotProgress(appointment, (from + second) / 60, seated).count,
        );

        expect(new Set(counts).size).toBe(counts.length);
    });

    it('counts from the second the patient was seated, not the minute', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('10:47', 30);

        expect(slotProgress(appointment, (secondsOfDay(seated) + 30) / 60, seated).count).toBe('0:30');
        expect(slotProgress(appointment, secondsOfDay(seated) / 60, seated).count).toBe('0:00');
    });

    it('splits the count from what it is counted against', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('11:00');
        const from = secondsOfDay(seated);

        const running = slotProgress(appointment, (from + 900) / 60, seated);
        expect(running.count).toBe('15:00');
        expect(running.of).toBe('/ 30 min');
        expect(running.label).toBe(`${running.count} ${running.of}`);

        const late = slotProgress(appointment, (from + 2700) / 60, seated);
        expect(late.count).toBe('15:00');
        expect(late.of).toBe('over');
        expect(late.label).toBe('15:00 over');
    });

    it('keeps the readout in English when the app is in Arabic', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const long = { ...appointment, durationMinutes: 90 };
        const seated = stamp('11:00');
        const from = secondsOfDay(seated);

        setRuntimeLocale('ar');
        try {
            const running = slotProgress(appointment, (from + 319) / 60, seated);
            expect(running.count).toBe('5:19');
            expect(running.of).toBe('/ 30 min');
            expect(running.label).toBe('5:19 / 30 min');

            expect(slotProgress(long, (from + 319) / 60, seated).of).toBe('/ 1h 30m');
            expect(slotProgress(appointment, (from + 2_700) / 60, seated).of).toBe('over');
        } finally {
            setRuntimeLocale('en');
        }
    });

    it('draws no Arabic in the readout, at any point in the slot', () => {
        const appointment = at('chair', '11:00', 'checked_in');
        const seated = stamp('11:00');
        const from = secondsOfDay(seated);

        setRuntimeLocale('ar');
        try {
            for (let second = 0; second <= 2_700; second += 60) {
                expect(slotProgress(appointment, (from + second) / 60, seated).label).not.toMatch(
                    /[\u0600-\u06ff]/,
                );
            }
        } finally {
            setRuntimeLocale('en');
        }
    });
});

describe('the month', () => {
    const at = (id: string, branchId: string, status: AppointmentStatus = 'booked'): Appointment =>
        ({
            id,
            branchId,
            startsAt: `2026-08-10T11:00:00+03:00`,
            status,
            durationMinutes: 30,
            patient: { id: `p-${id}`, name: id, phone: '' },
        }) as Appointment;

    it('sends the day to the branch holding most of it', () => {
        const rows = [at('a', 'maadi'), at('b', 'zamalek'), at('c', 'zamalek')];
        expect(busiestBranch(rows, 'maadi')).toBe('zamalek');
    });

    it('stays where it is when the day is split evenly', () => {
        const rows = [at('a', 'zamalek'), at('b', 'maadi')];
        expect(busiestBranch(rows, 'maadi')).toBe('maadi');
        expect(busiestBranch(rows, 'zamalek')).toBe('zamalek');
    });

    it('moves nothing on a day with nothing booked', () => {
        expect(busiestBranch([], 'maadi')).toBe(null);
    });

    it('counts every branch, and lets no cancellation pull the pick', () => {
        const loads = loadsFrom(
            [SATURDAY],
            [[at('a', 'maadi'), at('b', 'zamalek'), at('c', 'zamalek', 'cancelled')]],
            undefined,
            'maadi',
        );

        expect(loads.get(SATURDAY)?.count).toBe(2);
        expect(loads.get(SATURDAY)?.busiest).toBe('maadi');
    });

    it('still counts a day that has been worked through', () => {
        const loads = loadsFrom(
            [SATURDAY],
            [[at('a', 'maadi', 'done'), at('b', 'maadi', 'awaiting_payment'), at('c', 'maadi', 'no_show')]],
            undefined,
            'maadi',
        );

        expect(loads.get(SATURDAY)?.count).toBe(2);
        expect(loads.get(SATURDAY)?.busiest).toBe('maadi');
    });

    it('leaves a closed day at no load rather than dividing by nothing', () => {
        const loads = loadsFrom([FRIDAY], [[at('a', 'maadi')]], undefined, 'maadi');
        expect(loads.get(FRIDAY)?.fill).toBe(0);
        expect(loads.get(FRIDAY)?.slots).toBe(0);
    });
});

describe('errors', () => {
    it('says the slot is taken, and says what to do about it', () => {
        const overlap = new RequestError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment');

        const walkIn = describeError(overlap, 'walk-in');
        expect(walkIn.title).toBe('That slot is taken');
        expect(walkIn.body).toContain('shorter visit');

        expect(describeError(overlap, 'move').title).toBe('That slot is taken');
    });

    it('names the clinic server when the request never arrived', () => {
        const offline = new RequestError(ERROR_CODE.INTERNAL, 'fetch failed', { offline: true });
        expect(describeError(offline, 'check-in').body).toContain('Nothing was saved');
    });
});

describe('an empty day', () => {
    it('offers the booking the desk can actually make', () => {
        const desk = emptyDay(false, true);
        expect(desk.actionLabel).toBe('Book someone in');
        expect(desk.glyph).toBe('calendar');
    });

    it('offers the doctor nothing, and does not tell them to book', () => {
        const doctor = emptyDay(false, false);
        expect(doctor.actionLabel).toBeUndefined();
        expect(doctor.body).not.toContain('Book someone in');
        expect(doctor.body).not.toContain('walk-in');
    });

    it('states a past day rather than inviting one, and drops the ring with the offer', () => {
        const past = emptyDay(true, true);
        expect(past.title).toBe('Nothing happened this day');
        expect(past.actionLabel).toBeUndefined();
        expect(past.glyph).toBe('none');
    });

    it('says the same thing about a past day to both screens', () => {
        expect(emptyDay(true, false)).toEqual(emptyDay(true, true));
    });

    it('has Arabic for everything it says', () => {
        for (const [past, canBook] of [
            [false, true],
            [false, false],
            [true, true],
        ] as const) {
            const { title, body, actionLabel } = emptyDay(past, canBook);
            for (const copy of [title, body, actionLabel]) {
                if (copy) expect(COPY_AR).toHaveProperty([copy]);
            }
        }
    });
});

describe('money', () => {
    it('formats piastres as whole pounds, grouped', () => {
        expect(formatMoney(260_000)).toBe('EGP 2,600');
        expect(formatMoney(0)).toBe('EGP 0');
        expect(formatMoney(260_000, { language: 'ar' })).toBe('2,600 ج.م');
    });

    it('takes what has already been paid off the amount due', () => {
        expect(amountDue(260_000, 100_000)).toBe(160_000);
        expect(amountDue(260_000, 0)).toBe(260_000);
        expect(amountDue(50_000, 100_000)).toBe(0);
    });

    it('strips an amount where it is typed, not where it is parsed', () => {
        expect(poundsEntry('12.5')).toBe('125');
        expect(poundsEntry('1,200')).toBe('1200');
    });

    it('leaves the currency off a figure that already has one beside it', () => {
        expect(formatAmount(260_000)).toBe('2,600');
        expect(formatAmount(0)).toBe('0');
        expect(formatAmount(-90_000)).toBe('-900');
    });

    it('says what share of the procedure total a discount takes off', () => {
        expect(discountPercent(200_000, 150_000)).toBe(25);
        expect(discountPercent(300_000, 200_000)).toBe(33);
        expect(discountPercent(200_000, 0)).toBe(100);
    });

    it('never rounds part of the bill to none or all of it', () => {
        expect(discountPercent(1_000_000, 999_900)).toBe(1);
        expect(discountPercent(1_000_000, 100)).toBe(99);
    });

    it('sums what the procedures were priced under the catalogue, against the whole visit', () => {
        const defaults = new Map([
            ['filling', 100_000],
            ['cleaning', 50_000],
        ]);
        expect(
            procedureDiscount(
                [
                    { procedureId: 'filling', unitPrice: 80_000, quantity: 2 },
                    { procedureId: 'cleaning', unitPrice: 50_000, quantity: 1 },
                ],
                defaults,
            ),
        ).toEqual({ off: 40_000, usual: 250_000, percent: 16 });
    });

    it('nets a line priced over its default against one priced under it', () => {
        const defaults = new Map([
            ['filling', 10_000],
            ['cleaning', 10_000],
        ]);
        const line = (procedureId: string, unitPrice: number) => ({ procedureId, unitPrice, quantity: 1 });
        expect(procedureDiscount([line('filling', 8_000), line('cleaning', 20_000)], defaults)).toBeNull();
        expect(procedureDiscount([line('filling', 5_000), line('cleaning', 12_000)], defaults)).toEqual({
            off: 3_000,
            usual: 20_000,
            percent: 15,
        });
    });

    it('has nothing to say when every procedure is at or above its default', () => {
        const defaults = new Map([['filling', 100_000]]);
        expect(
            procedureDiscount([{ procedureId: 'filling', unitPrice: 120_000, quantity: 1 }], defaults),
        ).toBeNull();
        expect(
            procedureDiscount([{ procedureId: 'unknown', unitPrice: 10_000, quantity: 1 }], defaults),
        ).toBeNull();
        expect(procedureDiscount([], defaults)).toBeNull();
    });

    it('shows no percentage without a discount or a total to measure it against', () => {
        expect(discountPercent(200_000, 200_000)).toBeNull();
        expect(discountPercent(200_000, 250_000)).toBeNull();
        expect(discountPercent(0, 0)).toBeNull();
        expect(discountPercent(0, 100)).toBeNull();
        expect(discountPercent(Number.NaN, 100)).toBeNull();
    });
});

describe('dates', () => {
    it('speaks in the days the secretary uses', () => {
        const today = dateKey(new Date());
        expect(relativeDayLabel(today, today)).toBe('Today');
        expect(relativeDayLabel(addDays(today, 1), today)).toBe('Tomorrow');
        expect(relativeDayLabel(addDays(today, -1), today)).toBe('Yesterday');
    });

    it('reads the 24-hour clock the server sends', () => {
        expect(clockToMinutes('09:05')).toBe(545);
    });

    it('re-exports the twelve-hour clock', () => {
        expect(clock12(13 * 60)).toEqual({ time: '1:00', meridiem: 'PM' });
    });

    it('says the time the way the formatter says it, not re-cased', () => {
        const { time, meridiem } = clock12(12 * 60 + 15);

        expect(timeLabel(12 * 60 + 15)).toBe(`${time} ${meridiem}`);
        expect(timeLabel(13 * 60)).toBe('1:00 PM');
        expect(timeLabel(10 * 60 + 30)).toBe('10:30 AM');
    });

    it('names the weekday in the header pill only when the day is not today', () => {
        const today = dateKey(new Date());
        expect(formatDatePill(today, today).split(' ')).toHaveLength(2);
        expect(formatDatePill(addDays(today, 2), today).split(' ')).toHaveLength(3);
        expect(formatDatePill(today, today)).toBe(formatDatePill(today, today).toUpperCase());
    });

    it('spells the day out in full on the visit screens', () => {
        expect(formatLongDate('2026-06-11')).toBe('Thursday, 11 June 2026');
        expect(formatLongDate('2026-01-01')).toBe('Thursday, 1 January 2026');
    });
});

describe('a patient who is new here', () => {
    const TODAY = '2026-08-16';

    it('draws the separators around the digits typed so far', () => {
        expect(birthDateDisplay('')).toBe('');
        expect(birthDateDisplay('05')).toBe('05');
        expect(birthDateDisplay('0511')).toBe('05 / 11');
        expect(birthDateDisplay('05111990')).toBe('05 / 11 / 1990');
    });

    it('keeps only digits, and only eight of them', () => {
        expect(birthDateDigits('05 / 11 / 1990')).toBe('05111990');
        expect(birthDateDigits('0511199012')).toBe('05111990');
        expect(birthDateDigits('abc')).toBe('');
    });

    it('turns a day-first entry into the ISO date the server takes', () => {
        expect(birthDateIso('05111990', TODAY)).toBe('1990-11-05');
        expect(birthDateIso('29022024', TODAY)).toBe('2024-02-29');
    });

    it('refuses a date nobody was born on', () => {
        expect(birthDateIso('29022023', TODAY)).toBeNull();
        expect(birthDateIso('32011990', TODAY)).toBeNull();
        expect(birthDateIso('05131990', TODAY)).toBeNull();
        expect(birthDateIso('05111899', TODAY)).toBeNull();
    });

    it('refuses a birth date in the future, however plausible', () => {
        expect(birthDateIso('17082026', TODAY)).toBeNull();
        expect(birthDateIso('16082026', TODAY)).toBe('2026-08-16');
    });

    it('says nothing about an empty field, and asks for the rest of a half-typed one', () => {
        expect(birthDateError('', TODAY)).toBeNull();
        expect(birthDateError('0511', TODAY)).not.toBeNull();
        expect(birthDateError('05111990', TODAY)).toBeNull();
    });

    it('catches the obvious in an address and leaves a blank one alone', () => {
        expect(emailError('')).toBeNull();
        expect(emailError('  ')).toBeNull();
        expect(emailError('nadia@example.com')).toBeNull();
        expect(emailError('nadia@example')).not.toBeNull();
        expect(emailError('nadia.example.com')).not.toBeNull();
    });

    it('books on a name, a number and a date of birth', () => {
        const draft = { ...EMPTY_PATIENT_DRAFT, mode: 'new' as const, name: 'Nadia', phone: '01012345678' };
        expect(patientRefOf(draft)).toBeNull();

        const ref = patientRefOf({ ...draft, birthDate: '05111990' });
        expect(ref).toEqual({
            kind: 'new',
            name: 'Nadia',
            phone: '01012345678',
            email: null,
            birthDate: '1990-11-05',
            gender: null,
            notes: null,
        });
    });

    it('carries the details the desk did have', () => {
        const ref = patientRefOf({
            ...EMPTY_PATIENT_DRAFT,
            mode: 'new',
            name: '  Nadia  ',
            phone: '01012345678',
            email: 'nadia@example.com',
            birthDate: '05111990',
            gender: 'female',
            notes: 'Anxious about the drill.',
        });
        expect(ref).toEqual({
            kind: 'new',
            name: 'Nadia',
            phone: '01012345678',
            email: 'nadia@example.com',
            birthDate: '1990-11-05',
            gender: 'female',
            notes: 'Anxious about the drill.',
        });
    });

    it('holds the booking while a detail is half-written', () => {
        const half = {
            ...EMPTY_PATIENT_DRAFT,
            mode: 'new' as const,
            name: 'Nadia',
            phone: '01012345678',
            birthDate: '05111990',
        };
        expect(patientRefOf({ ...half, birthDate: '0511' })).toBeNull();
        expect(patientRefOf({ ...half, email: 'nadia@' })).toBeNull();
    });

    describe('under the clinic’s settings', () => {
        const draft = { ...EMPTY_PATIENT_DRAFT, mode: 'new' as const, name: 'Nadia', phone: '01012345678' };

        it('books with no date of birth once age is not required', () => {
            const ref = patientRefOf(draft, { requireAge: false, requireGender: false });
            expect(ref).toMatchObject({ kind: 'new', birthDate: null });
        });

        it('still holds a half-typed date of birth when age is not required', () => {
            expect(
                patientRefOf({ ...draft, birthDate: '0511' }, { requireAge: false, requireGender: false }),
            ).toBeNull();
        });

        it('holds the booking for a sex when the clinic requires one', () => {
            const requires = { requireAge: true, requireGender: true };
            const dated = { ...draft, birthDate: '05111990' };
            expect(patientRefOf(dated, requires)).toBeNull();
            expect(patientRefOf({ ...dated, gender: 'female' }, requires)).toMatchObject({
                gender: 'female',
            });
        });

        it('does not judge a patient already on file', () => {
            const picked = draftFor({ id: 'p1', name: 'Nadia', phone: '+201012345678' } as Patient);
            expect(patientRefOf(picked, { requireAge: true, requireGender: true })).toEqual({
                kind: 'existing',
                patientId: 'p1',
            });
        });
    });
});

describe('booking slots', () => {
    const SCHEDULE = [{ weekday: 1, branchId: 'b', opensAt: '10:00', closesAt: '12:00' }];
    const MONDAY = '2026-08-10';

    const booked = (minutes: number, durationMinutes: number, status: AppointmentStatus): Appointment =>
        ({
            id: String(minutes),
            startsAt: isoAt(MONDAY, minutes),
            durationMinutes,
            status,
            branchId: 'b',
        }) as Appointment;

    const at = (slots: readonly Slot[], minutes: number) => slots.find((slot) => slot.minutes === minutes);

    it('steps the length of the visit from opening to closing', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slots.map((slot) => slot.minutes)).toEqual([600, 630, 660, 690]);
        expect(slots.every((slot) => slot.state === 'free')).toBe(true);
    });

    it('stops at closing and keeps every time on the grid', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(660, 23, 'checked_in')],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slots.map((slot) => slot.minutes)).toEqual([600, 630, 660, 690]);
        expect(at(slots, 683)).toBeUndefined();
        expect(slots.every((slot) => slot.minutes < 720)).toBe(true);
    });

    it('still offers a time whose visit would end after closing, and says so', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 45,
            nowMinutes: null,
        });

        expect(at(slots, 690)?.state).toBe('free');
        expect(at(slots, 690)?.runsLate).toBe(true);
    });

    it('offers different times for different lengths', () => {
        const timesFor = (durationMinutes: number) =>
            slotsFor({
                dateKey: MONDAY,
                schedule: SCHEDULE,
                appointments: [],
                branchId: null,
                durationMinutes,
                nowMinutes: null,
            }).map((slot) => slot.minutes);

        expect(timesFor(20)).toEqual([600, 620, 640, 660, 680, 700]);
        expect(timesFor(45)).toEqual([600, 645, 690]);
    });

    it('draws no grid for a branch that does not work that day', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: 'other',
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slots).toHaveLength(0);
        expect(isClosed(MONDAY, SCHEDULE, 'other')).toBe(true);
        expect(isClosed(MONDAY, SCHEDULE, 'b')).toBe(false);
    });

    it('keeps the unscoped question clinic-wide, for the month grid', () => {
        expect(isClosed(MONDAY, SCHEDULE)).toBe(false);
        expect(openMinutes(MONDAY, SCHEDULE)).toBe(120);
    });

    it('offers a slot the visit would overrun closing on, and says so', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 45,
            nowMinutes: null,
        });

        expect(at(slots, 690)?.runsLate).toBe(true);
        expect(at(slots, 645)?.runsLate).toBe(false);
        expect(at(slots, 690)?.state).toBe('free');
    });

    it('takes every slot a booking overlaps, at either end', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(615, 30, 'booked')],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(at(slots, 600)?.state).toBe('taken');
        expect(at(slots, 630)?.state).toBe('taken');
        expect(at(slots, 660)?.state).toBe('free');
    });

    it('frees the time a cancellation or a no-show was holding', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(630, 30, 'cancelled'), booked(660, 30, 'no_show')],
            branchId: null,
            durationMinutes: 15,
            nowMinutes: null,
        });

        expect(slots.every((slot) => slot.state === 'free')).toBe(true);
    });

    it('does not offer a time today that has already gone by', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: 11 * 60,
        });

        expect(at(slots, 630)?.state).toBe('past');
        expect(at(slots, 660)?.state).toBe('free');
        expect(firstFreeSlot(slots)).toBe(660);
    });

    it('has no times at all on a closed day', () => {
        expect(
            slotsFor({
                dateKey: FRIDAY,
                schedule: undefined,
                appointments: [],
                branchId: null,
                durationMinutes: 30,
                nowMinutes: null,
            }),
        ).toEqual([]);
    });

    it('refuses a time that stopped being free while the sheet was open', () => {
        const slots = slotsFor({
            dateKey: MONDAY,
            schedule: SCHEDULE,
            appointments: [booked(630, 30, 'booked')],
            branchId: null,
            durationMinutes: 30,
            nowMinutes: null,
        });

        expect(slotIsFree(slots, 600)).toBe(true);
        expect(slotIsFree(slots, 630)).toBe(false);
        expect(slotIsFree(slots, null)).toBe(false);
    });
});

describe('the fortnight a booking is offered', () => {
    const SCHEDULE = [{ weekday: 1, branchId: 'b', opensAt: '10:00', closesAt: '12:00' }];
    const MONDAY = '2026-08-10';
    const NEXT_MONDAY = '2026-08-17';

    const booked = (day: string, minutes: number, branchId: string): Appointment =>
        ({
            id: `${day}:${minutes}`,
            startsAt: isoAt(day, minutes),
            durationMinutes: 30,
            status: 'booked' as AppointmentStatus,
            branchId,
        }) as Appointment;

    const fortnight = (fetched: readonly (readonly Appointment[])[] | undefined) =>
        fortnightSlots({
            days: [MONDAY, NEXT_MONDAY],
            fetched,
            schedule: SCHEDULE,
            branchId: 'b',
            durationMinutes: 30,
            today: MONDAY,
            nowMinutes: 0,
        });

    it('offers only the days the branch actually works', () => {
        expect(workingDaysIn(MONDAY, 14, SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        expect(workingDaysIn(MONDAY, 14, SCHEDULE, 'other')).toEqual([]);
    });

    it('offers nothing at all until the rows are in hand', () => {
        const pending = fortnight(undefined);

        expect(pending.openDays).toEqual([]);
        expect(pending.slotsByDay.size).toBe(0);
    });

    it('takes a day off the strip once its last time has gone', () => {
        const full = [600, 630, 660, 690].map((minutes) => booked(MONDAY, minutes, 'b'));
        const { openDays, slotsByDay } = fortnight([full, []]);

        expect(openDays).toEqual([NEXT_MONDAY]);
        expect(slotsByDay.get(MONDAY)?.every((slot) => slot.state === 'taken')).toBe(true);
        expect(slotsByDay.get(NEXT_MONDAY)?.every((slot) => slot.state === 'free')).toBe(true);
    });

    it('leaves a time free when the booking on it belongs to another branch', () => {
        const { openDays, slotsByDay } = fortnight([[booked(MONDAY, 600, 'maadi')], []]);

        expect(openDays).toEqual([MONDAY, NEXT_MONDAY]);
        expect(slotsByDay.get(MONDAY)?.[0]?.state).toBe('free');
    });

    it('frees the time held by the appointment being moved, and only that one', () => {
        const moving = booked(MONDAY, 600, 'b');
        const other = booked(MONDAY, 660, 'b');
        const { slotsByDay } = fortnight(withoutAppointment([[moving, other], []], moving.id));

        expect(slotsByDay.get(MONDAY)?.map((slot) => slot.state)).toEqual(['free', 'free', 'taken', 'free']);
        expect(withoutAppointment(undefined, moving.id)).toBeUndefined();
    });

    describe('a day past the strip window', () => {
        const MARCH_MONDAY = '2027-03-01';

        it('joins the days offered, in date order', () => {
            expect(daysOffered(MONDAY, 14, MARCH_MONDAY, SCHEDULE, 'b')).toEqual([
                MONDAY,
                NEXT_MONDAY,
                MARCH_MONDAY,
            ]);
        });

        it('is the whole list when the window itself has no working day', () => {
            expect(daysOffered(MONDAY, 14, MARCH_MONDAY, SCHEDULE, 'other')).toEqual([]);
            expect(daysOffered(MONDAY, 14, null, SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });

        it('is not offered on a day the branch is shut', () => {
            expect(daysOffered(MONDAY, 14, '2027-03-07', SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });

        it('does not double up a day the window already covers', () => {
            expect(daysOffered(MONDAY, 14, NEXT_MONDAY, SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });

        it('is ignored when it is in the past', () => {
            expect(daysOffered(MONDAY, 14, '2026-08-03', SCHEDULE, 'b')).toEqual([MONDAY, NEXT_MONDAY]);
        });
    });

    describe('which day the booking settles on', () => {
        const MARCH_MONDAY = '2027-03-01';
        const WORKING = [MONDAY, NEXT_MONDAY, MARCH_MONDAY];

        it('keeps a calendar pick that has no room left, and puts it on the strip', () => {
            expect(
                settleBookingDay({
                    date: MARCH_MONDAY,
                    farDay: MARCH_MONDAY,
                    workingDays: WORKING,
                    openDays: [MONDAY, NEXT_MONDAY],
                }),
            ).toEqual({ date: MARCH_MONDAY, strip: [MONDAY, NEXT_MONDAY, MARCH_MONDAY] });
        });

        it('moves a strip day that lost its room to the first day that still has some', () => {
            expect(
                settleBookingDay({
                    date: MONDAY,
                    farDay: null,
                    workingDays: WORKING,
                    openDays: [NEXT_MONDAY],
                }),
            ).toEqual({ date: NEXT_MONDAY, strip: [NEXT_MONDAY] });
        });

        it('leaves a day that still has room where it is', () => {
            expect(
                settleBookingDay({
                    date: NEXT_MONDAY,
                    farDay: null,
                    workingDays: WORKING,
                    openDays: [MONDAY, NEXT_MONDAY],
                }),
            ).toEqual({ date: NEXT_MONDAY, strip: [MONDAY, NEXT_MONDAY] });
        });

        it('leaves the date alone while no day has room, or the rows are still being read', () => {
            expect(
                settleBookingDay({ date: MONDAY, farDay: null, workingDays: WORKING, openDays: [] }),
            ).toEqual({
                date: MONDAY,
                strip: [],
            });
        });
    });
});

describe('book-next after a check-in', () => {
    it('sends a refused time to the booking screen’s wording, not a sheet’s', () => {
        const overlap = new RequestError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment');
        const booking = describeError(overlap, 'booking');

        expect(booking.title).toBe('That slot is taken');
        expect(booking.body).toContain('reloaded');
    });

    it('no longer tells anyone the times above have been reloaded', () => {
        const overlap = new RequestError(ERROR_CODE.SLOT_OVERLAP, 'that slot overlaps another appointment');

        for (const context of ['walk-in', 'booking', 'move', 'check-in', 'day', 'generic'] as const) {
            expect(describeError(overlap, context).body).not.toContain('above');
        }
    });
});

describe('the procedure plan', () => {
    const line = (id: string, tooth: Tooth | null, price: number): PlannedProcedure => ({
        id,
        procedureId: `proc-${id}`,
        name: 'Composite filling',
        variant: 'Class II',
        tooth,
        price,
        defaultPrice: price,
        quoted: false,
    });

    it('groups by tooth, in the order a chart is read, with no tooth last', () => {
        const groups = groupByTooth([
            line('a', 'LL4', 700_00),
            line('b', null, 400_00),
            line('c', 'UL6', 900_00),
            line('d', 'LL4', 300_00),
        ]);

        expect(groups.map((group) => group.tooth)).toEqual(['UL6', 'LL4', null]);
        expect(groups[1]?.items.map((item) => item.id)).toEqual(['a', 'd']);
        expect(groups[1]?.subtotal).toBe(1000_00);
    });

    it('names where a tooth is, and says so when there is none', () => {
        expect(toothPosition('UL6')).toBe('Upper left · 6');
        expect(toothPosition('LRE')).toBe('Lower right · E');
        expect(toothPosition(null)).toBe('No tooth assigned');
    });

    it('says nothing about a missing tooth on general procedures', () => {
        expect(toothPosition(null, true)).toBe('');
        expect(toothPosition('UL6', true)).toBe('Upper left · 6');
    });

    it('offers the child teeth after the permanent ones in every quadrant', () => {
        const upperRight = QUADRANTS.find((quadrant) => quadrant.key === 'UR');

        expect(upperRight?.codes[0]).toBe('UR8');
        expect(upperRight?.codes[7]).toBe('UR1');
        expect(upperRight?.codes.slice(8)).toEqual(['URA', 'URB', 'URC', 'URD', 'URE']);
    });

    it('totals the plan', () => {
        expect(totalOf([line('a', 'UL6', 900_00), line('b', null, 400_00)])).toBe(1300_00);
        expect(totalOf([])).toBe(0);
    });

    it('sends every line of the plan, with its tooth and without a catalogue price', () => {
        expect(bookedProcedures([line('a', 'UL6', 900_00), line('b', null, 400_00)])).toEqual([
            { procedureId: 'proc-a', tooth: 'UL6' },
            { procedureId: 'proc-b', tooth: null },
        ]);
        expect(bookedProcedures([])).toEqual([]);
    });

    it('sends a price the desk quoted', () => {
        const quoted = repriced(line('a', 'UL6', 900_00), 750_00);
        expect(bookedProcedures([quoted, line('b', null, 400_00)])).toEqual([
            { procedureId: 'proc-a', tooth: 'UL6', quotedPrice: 750_00 },
            { procedureId: 'proc-b', tooth: null },
        ]);
    });

    it('keeps two of the same procedure as two lines rather than a quantity', () => {
        expect(bookedProcedures([line('a', 'UL6', 900_00), line('b', 'UL6', 900_00)])).toHaveLength(2);
    });

    describe('a booking reopened for a reschedule', () => {
        const row = (id: string, name: string, defaultPrice: number, parentId: string | null = null) => ({
            id,
            parentId,
            name,
            defaultPrice,
            hasQuantity: false,
            isToothSpecific: false,
            isCheckup: false,
            active: true,
            sortOrder: 0,
        });
        const catalogue: ProcedureCategory[] = [
            {
                ...row('cat-filling', 'Composite filling', 0),
                children: [row('proc-a', 'Class II', 900_00, 'cat-filling')],
                selectable: false,
            },
            { ...row('proc-b', 'Scaling', 400_00), children: [], selectable: true },
        ];
        const booked = (quotedPrice: number | null): Appointment['procedures'] => [
            {
                id: 'a',
                procedureId: 'proc-a',
                name: 'Class II',
                quantity: 1,
                tooth: 'UL6',
                note: null,
                quotedPrice,
            },
            {
                id: 'b',
                procedureId: 'proc-b',
                name: 'Scaling',
                quantity: 1,
                tooth: null,
                note: null,
                quotedPrice: null,
            },
        ];

        it('prices a line at the catalogue unless a price was quoted', () => {
            expect(planFrom(booked(null), catalogue).map((row) => [row.price, row.defaultPrice])).toEqual([
                [900_00, 900_00],
                [400_00, 400_00],
            ]);
            expect(planFrom(booked(750_00), catalogue)[0]).toMatchObject({
                price: 750_00,
                defaultPrice: 900_00,
            });
        });

        it('is unchanged as it opens, quoted or not', () => {
            expect(samePlan(planFrom(booked(null), catalogue), booked(null))).toBe(true);
            expect(samePlan(planFrom(booked(750_00), catalogue), booked(750_00))).toBe(true);
        });

        it('counts a new price on its own as a change, and sends it', () => {
            const [first, second] = planFrom(booked(null), catalogue);
            if (!first || !second) throw new Error('plan lost a line');
            const edited = [repriced(first, 800_00), second];

            expect(samePlan(edited, booked(null))).toBe(false);
            expect(bookedProcedures(edited)[0]).toEqual({
                procedureId: 'proc-a',
                tooth: 'UL6',
                quotedPrice: 800_00,
            });
        });

        it('drops a quote set back to the catalogue price', () => {
            const [first, second] = planFrom(booked(750_00), catalogue);
            if (!first || !second) throw new Error('plan lost a line');
            const restored = [repriced(first, 900_00), second];

            expect(samePlan(restored, booked(750_00))).toBe(false);
            expect(bookedProcedures(restored)[0]).toEqual({ procedureId: 'proc-a', tooth: 'UL6' });
        });

        it('keeps a quote the catalogue has caught up with', () => {
            const [first, second] = planFrom(booked(900_00), catalogue);
            if (!first || !second) throw new Error('plan lost a line');

            expect(samePlan([first, second], booked(900_00))).toBe(true);
            expect(bookedProcedures([first, repriced(second, 350_00)])[0]).toEqual({
                procedureId: 'proc-a',
                tooth: 'UL6',
                quotedPrice: 900_00,
            });
        });
    });

    it('reads a line back the way the note and the summary print it', () => {
        expect(describeProcedure(line('a', 'UL6', 0))).toBe('Composite filling · Class II (UL6)');
        expect(describeProcedure({ ...line('b', null, 0), variant: null })).toBe('Composite filling');
    });
});

describe('a day running late', () => {
    const MONDAY = '2026-08-10';

    const row = (
        id: string,
        minutes: number,
        durationMinutes: number,
        status: AppointmentStatus,
        channel: 'desk' | 'walk_in' = 'desk',
    ): Appointment =>
        ({
            id,
            startsAt: isoAt(MONDAY, minutes),
            durationMinutes,
            status,
            channel,
            branchId: 'b',
            updatedAt: isoAt(MONDAY, minutes),
        }) as Appointment;

    it('is on time when the chair is inside its slot', () => {
        const delay = dayDelay([row('a', 600, 30, 'checked_in')], 615);

        expect(delay).toEqual(ON_TIME);
        expect(delayLabel(delay)).toBeNull();
    });

    it('counts the overrun to the minute and slides by the slot', () => {
        const delay = dayDelay([row('a', 600, 30, 'checked_in')], 642);

        expect(delay.fromChair).toBe(12);
        expect(delay.minutes).toBe(15);
        expect(delayLabel(delay)).toBe('12 min late');
    });

    it('does not count a waiting walk-in, whose minutes are already in the layout', () => {
        const delay = dayDelay(
            [row('chair', 600, 30, 'checked_in'), row('walk', 610, 20, 'checked_in', 'walk_in')],
            615,
            new Map([
                ['chair', isoAt(MONDAY, 600)],
                ['walk', isoAt(MONDAY, 610)],
            ]),
        );

        expect(delay).toEqual(ON_TIME);
        expect(delayLabel(delay)).toBeNull();
    });

    it('slides by the chair alone when a walk-in is waiting behind it', () => {
        const delay = dayDelay(
            [row('chair', 600, 30, 'checked_in'), row('walk', 620, 20, 'checked_in', 'walk_in')],
            642,
            new Map([
                ['chair', isoAt(MONDAY, 600)],
                ['walk', isoAt(MONDAY, 620)],
            ]),
        );

        expect(delay.fromChair).toBe(12);
        expect(delay.minutes).toBe(15);
        expect(delayLabel(delay)).toBe('12 min late');
    });

    it('leaves a pushed booking reading the time the server moved it to', () => {
        const appointments = [
            row('chair', 720, 30, 'checked_in'),
            row('walk', 750, 30, 'checked_in', 'walk_in'),
            row('booked', 780, 30, 'booked'),
        ];
        const delay = dayDelay(
            appointments,
            735,
            new Map([
                ['chair', isoAt(MONDAY, 720)],
                ['walk', isoAt(MONDAY, 750)],
            ]),
        );

        expect(delay.minutes).toBe(0);
        expect(projectedStart(appointments[2] as Appointment, delay, 735)).toBe(780);
    });

    it('does not count a booked patient who is merely waiting', () => {
        const delay = dayDelay(
            [row('chair', 600, 30, 'checked_in'), row('early', 610, 30, 'checked_in')],
            615,
            new Map([
                ['chair', isoAt(MONDAY, 600)],
                ['early', isoAt(MONDAY, 610)],
            ]),
        );

        expect(delay.minutes).toBe(0);
    });

    it('slides every booked time by the delay, and leaves history alone', () => {
        const delay = dayDelay([row('chair', 600, 30, 'checked_in')], 642);
        const later = row('later', 720, 30, 'booked');
        const done = row('done', 540, 30, 'done');

        expect(projectedStart(later, delay, 642)).toBe(735);
        expect(isProjected(later, delay)).toBe(true);

        expect(projectedStart(done, delay, 642)).toBe(540);
        expect(isProjected(done, delay)).toBe(false);
    });

    it('never projects a time into the past', () => {
        const delay = dayDelay([row('chair', 600, 30, 'checked_in')], 700);
        expect(projectedStart(row('missed', 615, 30, 'booked'), delay, 700)).toBe(700);
    });

    it('keeps every projection on the slot grid, whatever the odd minute', () => {
        const delay = dayDelay([row('chair', 600, 30, 'checked_in')], 637);

        expect(delay.minutes).toBe(10);
        expect(
            [720, 750, 780].map((minutes) => projectedStart(row('x', minutes, 30, 'booked'), delay, 637)),
        ).toEqual([730, 760, 790]);
    });

    it('cannot be late on a day the clock has not reached', () => {
        expect(dayDelay([row('chair', 600, 30, 'checked_in')], null)).toEqual(ON_TIME);
    });
});

describe('the total the chair and the desk show', () => {
    const filling = { unitPrice: 220_000, quantity: 1, isCheckup: false };
    const checkup = { unitPrice: 15_000, quantity: 1, isCheckup: true };

    const totalOfList = (lines: ChargeableLine[]) => chargeableTotal(lines, checkupIsWaived(lines));

    it('leaves the checkup out once other work is on the list', () => {
        expect(totalOfList([filling, checkup])).toBe(220_000);
    });

    it('charges the checkup when it is the only thing done', () => {
        expect(totalOfList([checkup])).toBe(15_000);
    });

    it('agrees with the server, which is what the confirmation spends', () => {
        for (const lines of [[filling, checkup], [checkup], [filling], []]) {
            expect(totalOfList(lines)).toBe(computeTotal(lines));
        }
    });

    it('counts a quantity on the lines it does count', () => {
        expect(totalOfList([{ unitPrice: 220_000, quantity: 3, isCheckup: false }, checkup])).toBe(660_000);
    });

    it('strikes the waived checkup out of its own tooth group too', () => {
        const waived = checkupIsWaived([filling, checkup]);

        expect(chargeableTotal([checkup], waived)).toBe(0);
        expect(chargeableTotal([filling], waived) + chargeableTotal([checkup], waived)).toBe(
            totalOfList([filling, checkup]),
        );
    });
});

describe('what the catalogue offers', () => {
    const category = (
        id: string,
        isToothSpecific: boolean,
        children: { id: string; isToothSpecific: boolean }[] = [],
    ) =>
        ({
            id,
            name: id,
            parentId: null,
            defaultPrice: 0,
            hasQuantity: false,
            isToothSpecific,
            isCheckup: false,
            active: true,
            sortOrder: 0,
            selectable: children.length === 0,
            children: children.map((child) => ({
                ...child,
                name: child.id,
                parentId: id,
                defaultPrice: 0,
                hasQuantity: false,
                isCheckup: false,
                active: true,
                sortOrder: 0,
            })),
        }) as ProcedureCategory;

    it('offers only tooth work once a tooth is chosen', () => {
        const offered = offeredFor([category('extraction', true), category('scaling', false)], true);

        expect(offered.map((row) => row.id)).toEqual(['extraction']);
    });

    it('offers the whole catalogue when no tooth is assigned', () => {
        const offered = offeredFor([category('extraction', true), category('scaling', false)], false);

        expect(offered.map((row) => row.id)).toEqual(['extraction', 'scaling']);
    });

    it('asks no tooth of a clinic on general procedures', () => {
        const catalogue = [
            category('extraction', true),
            category('filling', false, [{ id: 'class-i', isToothSpecific: true }]),
        ];

        expect(asksTooth(catalogue)).toBe(true);
        expect(asksTooth(withoutTeeth(catalogue))).toBe(false);
    });

    it('asks for the tooth first while the catalogue is still loading', () => {
        expect(asksTooth(undefined)).toBe(true);
    });

    it('asks a general clinic for no tooth even before the catalogue arrives', () => {
        expect(asksTooth(undefined, true)).toBe(false);
    });

    it('keeps a heading only for the variants that fit', () => {
        const filling = category('filling', false, [
            { id: 'class-i', isToothSpecific: true },
            { id: 'whitening', isToothSpecific: false },
        ]);

        const offered = offeredFor([filling], true);

        expect(offered.map((row) => row.id)).toEqual(['filling']);
        expect(offered[0]?.children.map((child) => child.id)).toEqual(['class-i']);
    });

    it('drops a heading whose every variant is mouth work once a tooth is chosen', () => {
        const filling = category('filling', false, [{ id: 'whitening', isToothSpecific: false }]);

        expect(offeredFor([filling], true)).toEqual([]);
    });

    it('keeps every variant of a heading when no tooth is assigned', () => {
        const filling = category('filling', false, [
            { id: 'class-i', isToothSpecific: true },
            { id: 'whitening', isToothSpecific: false },
        ]);

        const offered = offeredFor([filling], false);

        expect(offered[0]?.children.map((child) => child.id)).toEqual(['class-i', 'whitening']);
    });
});
