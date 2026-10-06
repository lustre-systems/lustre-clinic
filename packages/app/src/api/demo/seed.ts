/**
 * A clinic, built around the clock at the moment the app opens.
 *
 * Nothing here is dated absolutely. The demo is given at whatever hour it is
 * given at, and a dataset pinned to a morning is a dataset that shows an empty
 * afternoon and a closed clinic to anyone opening it in the evening — so the
 * live queue is placed relative to `now`, and the opening hours are widened
 * afterwards to cover whatever was generated. Open it at nine in the morning or
 * nine at night and it looks the same: work behind, someone in the chair, a
 * queue, and bookings ahead.
 *
 * The split in `server/src/modules/seed/seed.service.ts` is kept, and for its
 * reason. The states that mean "right now" — in the chair, at the desk, waiting
 * — are *reached*, by calling the same handlers the app calls in the order a
 * day actually happens, because those are the states a hand-written row gets
 * wrong: a check-in stamped for later, a visit with no `inChairAt`, a
 * checked-in patient whose visit has none of the procedures their booking
 * planned. History is different: a closed visit is a settled fact with no live
 * semantics to invent, so the past fortnight is written directly, which is what
 * keeps the seed fast enough to run on a phone at launch.
 */
import {
    addDays,
    DEFAULT_DURATION_MINUTES,
    DEFAULT_DURATION_OPTIONS,
    DEFAULT_REMINDER_LEAD_HOURS,
    DEFAULT_REMINDER_NOTIFY_AT,
    DEFAULT_REMINDER_REPEAT_MINUTES,
    DEFAULT_REMINDER_TEMPLATE,
    DEFAULT_REQUIRE_AGE,
    DEFAULT_REQUIRE_GENDER,
    dateKey,
    instantAt,
    minutesOfDay,
    type PaymentMethod,
    pad2,
    type Tooth,
} from '@lustre/shared';
import {
    type AppointmentRow,
    type BranchRow,
    type CustomQuestionRow,
    type DemoDb,
    type PatientRow,
    type ProcedureTypeRow,
    setDb,
} from './db';
import { appointmentHandlers } from './handlers/appointment';
import { visitHandlers } from './handlers/visit';
import { buildPatientRef, buildRef, computeTotal, normalizePhone, uuidv7 } from './rules';

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * The grid the seeded day is drawn on. Ten rather than five because five is how
 * a real book is *allowed* to be written, not how one looks: a clinic sets
 * appointments at 10:20 and 10:40, and a demo full of 10:25 and 10:35 reads as
 * a machine's output rather than a day someone planned.
 *
 * Every seeded start goes through `at`, so this is the only place the grid is
 * decided. It is not `MIN_SLOT_STEP` — the picker still lets a secretary put
 * someone on a five, and that is a rule about what is permitted, not about what
 * the demo should be showing.
 */
const GRID = 10 * MINUTE;

/** Minutes are rounded so the seeded day sits on the clock rather than on the launch. */
function at(offsetMinutes: number, from: number = Date.now()): Date {
    return new Date(Math.round((from + offsetMinutes * MINUTE) / GRID) * GRID);
}

/** `HH:MM` on the clinic's clock. */
function clinicHhMm(at: Date | number): string {
    const minutes = minutesOfDay(at);
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function money(pounds: number): number {
    return pounds * 100;
}

interface Catalogue {
    checkup: ProcedureTypeRow;
    cleaning: ProcedureTypeRow;
    fillingClassI: ProcedureTypeRow;
    fillingClassII: ProcedureTypeRow;
    rootCanalMolar: ProcedureTypeRow;
    rootCanalAnterior: ProcedureTypeRow;
    extractionSimple: ProcedureTypeRow;
    extractionSurgical: ProcedureTypeRow;
    crownZirconia: ProcedureTypeRow;
    whitening: ProcedureTypeRow;
    xray: ProcedureTypeRow;
    all: ProcedureTypeRow[];
}

function procedure(
    name: string,
    defaultPrice: number,
    sortOrder: number,
    extra: Partial<ProcedureTypeRow> = {},
): ProcedureTypeRow {
    return {
        id: uuidv7(),
        parentId: null,
        name,
        defaultPrice,
        hasQuantity: false,
        isToothSpecific: false,
        isCheckup: false,
        active: true,
        sortOrder,
        ...extra,
    };
}

function buildCatalogue(): Catalogue {
    const checkup = procedure('Consultation', money(150), 0, { isCheckup: true });
    const cleaning = procedure('Scaling & polishing', money(600), 1);

    const fillings = procedure('Composite filling', 0, 2);
    const fillingClassI = procedure('Class I', money(700), 0, {
        parentId: fillings.id,
        isToothSpecific: true,
    });
    const fillingClassII = procedure('Class II', money(900), 1, {
        parentId: fillings.id,
        isToothSpecific: true,
    });

    const rootCanals = procedure('Root canal', 0, 3);
    const rootCanalAnterior = procedure('Anterior', money(2200), 0, {
        parentId: rootCanals.id,
        isToothSpecific: true,
    });
    const rootCanalMolar = procedure('Molar', money(3500), 1, {
        parentId: rootCanals.id,
        isToothSpecific: true,
    });

    const extractions = procedure('Extraction', 0, 4);
    const extractionSimple = procedure('Simple', money(800), 0, {
        parentId: extractions.id,
        isToothSpecific: true,
    });
    const extractionSurgical = procedure('Surgical', money(2000), 1, {
        parentId: extractions.id,
        isToothSpecific: true,
    });

    const crowns = procedure('Crown', 0, 5);
    const crownZirconia = procedure('Zirconia', money(4500), 0, {
        parentId: crowns.id,
        isToothSpecific: true,
    });
    const crownPfm = procedure('Porcelain fused to metal', money(3000), 1, {
        parentId: crowns.id,
        isToothSpecific: true,
    });

    const whitening = procedure('Whitening', money(2500), 6);
    const xray = procedure('Periapical x-ray', money(120), 7, { hasQuantity: true });

    return {
        checkup,
        cleaning,
        fillingClassI,
        fillingClassII,
        rootCanalMolar,
        rootCanalAnterior,
        extractionSimple,
        extractionSurgical,
        crownZirconia,
        whitening,
        xray,
        all: [
            checkup,
            cleaning,
            fillings,
            fillingClassI,
            fillingClassII,
            rootCanals,
            rootCanalAnterior,
            rootCanalMolar,
            extractions,
            extractionSimple,
            extractionSurgical,
            crowns,
            crownZirconia,
            crownPfm,
            whitening,
            xray,
        ],
    };
}

const NAMES: readonly [name: string, phone: string, birthDate: string | null][] = [
    ['Nour Hassan', '01001234567', '1991-04-12'],
    ['Mariam Adel', '01009876543', '1988-11-03'],
    ['Omar Khaled', '01112223344', '1979-06-21'],
    ['Youssef Ibrahim', '01223344556', '2001-02-17'],
    ['Salma Farouk', '01098765432', '1995-09-30'],
    ['Ahmed Zaki', '01144556677', '1967-01-08'],
    ['Laila Mostafa', '01277889900', '2014-05-26'],
    ['Karim Sabry', '01011223344', '1983-08-14'],
    ['Dina Ashraf', '01155667788', '1999-12-02'],
    ['Tarek Mahmoud', '01266778899', '1974-03-19'],
    ['Hana Sameh', '01033445566', '2009-07-07'],
    ['Mostafa Nabil', '01177889911', '1992-10-11'],
    ['Rana Gamal', '01288990011', '1986-01-29'],
    ['Sherif Amin', '01022334455', '1971-11-16'],
    ['Yara Fouad', '01199001122', '2004-04-04'],
    ['Amr Hesham', '01255443322', null],
];

function buildPatients(createdFrom: number): PatientRow[] {
    return NAMES.map(([name, phone, birthDate], index) => ({
        id: uuidv7(),
        ref: buildPatientRef(),
        name,
        phone: normalizePhone(phone),
        email: null,
        // Newest first in the register is what the patients tab opens on, so
        // they are registered in the order they are listed here.
        birthDate,
        gender: null,
        custom: {},
        notes: null,
        legacyRef: index < 4 ? `OLD-${1200 + index}` : null,
        createdAt: new Date(createdFrom - (NAMES.length - index) * 3 * DAY),
    }));
}

function buildQuestions(): CustomQuestionRow[] {
    return [
        {
            id: uuidv7(),
            key: 'allergies',
            label: 'Allergies',
            labelAr: 'الحساسية',
            kind: 'text',
            options: null,
            required: false,
            sortOrder: 0,
            active: true,
        },
        {
            id: uuidv7(),
            key: 'diabetic',
            label: 'Diabetic',
            labelAr: 'مريض سكر',
            kind: 'boolean',
            options: null,
            required: true,
            sortOrder: 1,
            active: true,
        },
        {
            id: uuidv7(),
            key: 'blood_thinners',
            label: 'On blood thinners',
            labelAr: 'يتناول مسيلات الدم',
            kind: 'boolean',
            options: null,
            required: false,
            sortOrder: 2,
            active: true,
        },
        {
            id: uuidv7(),
            key: 'heard_about_us',
            label: 'How did you hear about us',
            labelAr: 'كيف عرفت عنا',
            kind: 'select',
            options: ['A friend', 'Facebook', 'Instagram', 'Walked past', 'Another dentist'],
            required: false,
            sortOrder: 3,
            active: true,
        },
    ];
}

interface PlannedLine {
    procedure: ProcedureTypeRow;
    quantity?: number;
    tooth?: Tooth;
}

/**
 * A visit that is over: the appointment is `done`, the visit is priced and
 * closed, and whatever was paid was paid on the day. Written directly rather
 * than walked through the handlers — there is no live state here to get wrong,
 * and a fortnight of history through `checkIn`/`checkOut` would cost the launch
 * far more than it is worth.
 */
function writeClosedVisit(
    db: DemoDb,
    options: {
        patient: PatientRow;
        branch: BranchRow;
        startsAt: Date;
        durationMinutes: number;
        lines: PlannedLine[];
        paid: number | 'full';
        method: PaymentMethod;
    },
): void {
    const { patient, branch, startsAt, durationMinutes, lines, method } = options;

    const appointment: AppointmentRow = {
        id: uuidv7(),
        ref: buildRef(startsAt),
        patientId: patient.id,
        branchId: branch.id,
        startsAt,
        durationMinutes,
        note: null,
        status: 'done',
        channel: 'desk',
        labStatus: null,
        isOpeningBalance: false,
        isImported: false,
        dateUnknown: false,
        createdAt: new Date(startsAt.getTime() - 3 * DAY),
        updatedAt: new Date(startsAt.getTime() + durationMinutes * MINUTE),
    };
    db.appointments.push(appointment);

    db.reminders.push({
        id: uuidv7(),
        appointmentId: appointment.id,
        dueAt: new Date(startsAt.getTime() - DEFAULT_REMINDER_LEAD_HOURS * 3_600_000),
        status: 'sent',
        sentAt: new Date(startsAt.getTime() - 20 * 3_600_000),
    });

    const visitId = uuidv7();
    const closedAt = new Date(startsAt.getTime() + durationMinutes * MINUTE);

    for (const line of lines) {
        db.visitProcedures.push({
            id: uuidv7(),
            visitId,
            procedureId: line.procedure.id,
            quantity: line.quantity ?? 1,
            unitPrice: line.procedure.defaultPrice,
            tooth: line.tooth ?? null,
            note: null,
        });
    }

    const chargedTotal = computeTotal(
        lines.map((line) => ({
            unitPrice: line.procedure.defaultPrice,
            quantity: line.quantity ?? 1,
            isCheckup: line.procedure.isCheckup,
        })),
    );

    db.visits.push({
        id: visitId,
        appointmentId: appointment.id,
        checkedInAt: new Date(startsAt.getTime() - 6 * MINUTE),
        inChairAt: startsAt,
        pricedAt: closedAt,
        completedAt: closedAt,
        computedTotal: chargedTotal,
        chargedTotal,
        createdAt: new Date(startsAt.getTime() - 6 * MINUTE),
    });

    const paid = options.paid === 'full' ? chargedTotal : options.paid;
    if (paid > 0) {
        db.payments.push({
            id: uuidv7(),
            visitId,
            amount: paid,
            method,
            methodNote: null,
            paidAt: closedAt,
        });
    }
}

/** Debt carried over from the old system: a synthetic appointment and visit at the cutoff. */
function writeOpeningBalance(db: DemoDb, patient: PatientRow, branch: BranchRow, amount: number): void {
    // On the grid like every other row, even though nobody was ever booked into
    // it — it is drawn in the patient's history beside real appointments.
    const cutoff = at(0, Date.now() - 60 * DAY);

    const appointment: AppointmentRow = {
        id: uuidv7(),
        ref: buildRef(cutoff),
        patientId: patient.id,
        branchId: branch.id,
        startsAt: cutoff,
        durationMinutes: 10,
        note: 'Opening balance carried over from the old system',
        status: 'done',
        channel: 'desk',
        labStatus: null,
        isOpeningBalance: true,
        isImported: false,
        dateUnknown: false,
        createdAt: cutoff,
        updatedAt: cutoff,
    };
    db.appointments.push(appointment);

    db.visits.push({
        id: uuidv7(),
        appointmentId: appointment.id,
        checkedInAt: cutoff,
        inChairAt: null,
        pricedAt: cutoff,
        completedAt: cutoff,
        computedTotal: amount,
        chargedTotal: amount,
        createdAt: cutoff,
    });
}

export function emptyDb(): DemoDb {
    return {
        branches: [],
        clinicDays: [],
        patients: [],
        procedureTypes: [],
        appointments: [],
        appointmentProcedures: [],
        visits: [],
        visitProcedures: [],
        payments: [],
        customQuestions: [],
        reminders: [],
        refEdits: [],
        roleGrants: [],
        devices: [],
        settings: {
            clinicName: 'Nile Clinic',
            clinicPhone: '+20221234567',
            durationOptions: [...DEFAULT_DURATION_OPTIONS],
            defaultDuration: DEFAULT_DURATION_MINUTES,
            reminderLeadHours: DEFAULT_REMINDER_LEAD_HOURS,
            reminderNotifyAt: DEFAULT_REMINDER_NOTIFY_AT,
            reminderRepeatMinutes: DEFAULT_REMINDER_REPEAT_MINUTES,
            reminderDismissedOn: null,
            reminderTemplate: DEFAULT_REMINDER_TEMPLATE,
            // The server's patient counter. The demo still draws random refs,
            // so this only fills the field — but it is also the floor an old
            // patient's number is checked against, and at 1 every number off a
            // paper file would be refused as one the sequence still owes. A
            // clinic that has moved over has set it above its old numbers.
            patientRefNext: 1001,
            requireAge: DEFAULT_REQUIRE_AGE,
            requireGender: DEFAULT_REQUIRE_GENDER,
            askToEditOnFinish: true,
            clinicType: 'dental',
            requireProvisioning: false,
            updatedAt: new Date(),
        },
    };
}

export function seedDemoDb(): DemoDb {
    const db = emptyDb();
    setDb(db);

    const main: BranchRow = {
        id: uuidv7(),
        name: 'Maadi',
        address: '12 Road 9, Maadi',
        active: true,
        whatsappApp: 'business',
    };
    const second: BranchRow = {
        id: uuidv7(),
        name: 'Zamalek',
        address: '4 Brazil St, Zamalek',
        active: true,
        whatsappApp: 'regular',
    };
    db.branches.push(main, second);

    const catalogue = buildCatalogue();
    db.procedureTypes.push(...catalogue.all);

    db.customQuestions.push(...buildQuestions());

    const patients = buildPatients(Date.now());
    db.patients.push(...patients);

    const patient = (index: number): PatientRow => {
        const row = patients[index];
        if (!row) throw new Error(`no seeded patient at ${index}`);
        return row;
    };

    // --- the fortnight behind -----------------------------------------------

    const history: PlannedLine[][] = [
        [{ procedure: catalogue.cleaning }],
        [{ procedure: catalogue.fillingClassII, tooth: 'UL6' }],
        [{ procedure: catalogue.checkup }],
        [
            { procedure: catalogue.rootCanalMolar, tooth: 'LR7' },
            { procedure: catalogue.xray, quantity: 2 },
        ],
        [{ procedure: catalogue.extractionSimple, tooth: 'UR8' }],
        [{ procedure: catalogue.whitening }],
        [{ procedure: catalogue.crownZirconia, tooth: 'UL4' }],
        [{ procedure: catalogue.fillingClassI, tooth: 'LL5' }],
    ];

    for (let daysAgo = 14; daysAgo >= 1; daysAgo -= 1) {
        const midday = new Date(instantAt(addDays(dateKey(Date.now()), -daysAgo), 11 * 60));

        for (let slot = 0; slot < 3; slot += 1) {
            const index = (daysAgo * 3 + slot) % patients.length;
            const lines = history[(daysAgo + slot) % history.length] ?? [];
            // 90, not 75: three 30-minute visits spread across the same midday,
            // but landing on 11:00 / 12:30 / 14:00 rather than on a quarter past.
            const startsAt = new Date(midday.getTime() + slot * 90 * MINUTE);

            // Roughly one visit in five leaves something on the books, which is
            // what puts a spread of debtors on the money screens.
            const owes = (daysAgo + slot) % 5 === 0;

            writeClosedVisit(db, {
                patient: patient(index),
                branch: main,
                startsAt,
                durationMinutes: 30,
                lines,
                paid: owes ? money(200) : 'full',
                method: slot === 1 ? 'visa' : 'cash',
            });
        }
    }

    writeOpeningBalance(db, patient(2), main, money(800));
    writeOpeningBalance(db, patient(9), main, money(1500));

    // --- today, reached through the handlers --------------------------------

    /**
     * `slotMinutes` is the appointment; `minutesAgo` is when they came through
     * the door. They are two different facts and the seed has to keep them
     * apart: the slots are what the overlap rule is enforced against, so making
     * them the arrival times books four people on top of each other, and the
     * arrival times are what the queue is ordered by, so making them the slots
     * says everyone turned up exactly on time. Early, late and still waiting
     * are the interesting cases, and they only exist in the gap between the
     * two.
     */
    interface Arrival {
        patientIndex: number;
        slotMinutes: number;
        minutesAgo: number;
        seatedMinutesAgo?: number;
        reach: 'waiting' | 'chair' | 'desk';
        lines: PlannedLine[];
    }

    const arrivals: Arrival[] = [
        {
            patientIndex: 0,
            slotMinutes: -90,
            minutesAgo: 95,
            seatedMinutesAgo: 85,
            reach: 'desk',
            lines: [{ procedure: catalogue.rootCanalAnterior, tooth: 'UR1' }],
        },
        {
            patientIndex: 5,
            slotMinutes: -50,
            minutesAgo: 40,
            seatedMinutesAgo: 12,
            reach: 'chair',
            lines: [{ procedure: catalogue.fillingClassII, tooth: 'LL6' }],
        },
        // Running late: their slot started twenty minutes ago and they are
        // still in the waiting room, because the chair has not freed.
        {
            patientIndex: 11,
            slotMinutes: -20,
            minutesAgo: 20,
            reach: 'waiting',
            lines: [{ procedure: catalogue.cleaning }],
        },
        // Early, which is the other way a queue forms.
        {
            patientIndex: 6,
            slotMinutes: 10,
            minutesAgo: 8,
            reach: 'waiting',
            lines: [{ procedure: catalogue.checkup }],
        },
    ];

    const booked = arrivals.map((arrival) =>
        appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient(arrival.patientIndex).id },
            branchId: main.id,
            startsAt: at(arrival.slotMinutes).toISOString(),
            durationMinutes: 30,
            procedures: arrival.lines.map((line) => ({
                procedureId: line.procedure.id,
                quantity: line.quantity ?? 1,
                tooth: line.tooth ?? null,
            })),
            offsetMinutes: 0,
        }),
    );

    // Check-in is refused off the appointment's own day and the chair is kept to
    // one day, but a seed run just after midnight books its earlier arrivals onto
    // yesterday. So while the handlers run every arrival sits on today's clock —
    // only once all of them are booked, or the overlap rule sees them stacked —
    // and each slot goes back in the pass below, with the stamps.
    const checkInAt = new Date();
    const seated = booked.map((appointment) => {
        const bookedAt = appointment.startsAt;
        appointment.startsAt = checkInAt;
        const visit = visitHandlers.checkIn({ appointmentId: appointment.id });
        return { appointment, visit, bookedAt };
    });

    // A second pass, not woven into the first: the desk sends a patient on only
    // once the next one is standing there, and doing it in one loop would empty
    // the chair before anybody had arrived to take it.
    for (const [index, arrival] of arrivals.entries()) {
        if (arrival.reach !== 'desk') continue;
        const row = seated[index];
        if (row) appointmentHandlers.awaitPayment({ id: row.appointment.id });
    }

    // The handlers stamped everything with the instant the seed ran, which is a
    // true record of a queue nobody waited in. Only the clocks move here.
    for (const [index, arrival] of arrivals.entries()) {
        const row = seated[index];
        if (!row) continue;

        const visit = db.visits.find((candidate) => candidate.id === row.visit.id);
        const appointment = db.appointments.find((candidate) => candidate.id === row.appointment.id);
        if (!visit || !appointment) continue;

        const arrivedAt = at(-arrival.minutesAgo);
        // A patient still waiting has no seating time and must not be given one:
        // that null is what the chair's bar reads to know they have not started.
        const seatedAt = arrival.seatedMinutesAgo === undefined ? null : at(-arrival.seatedMinutesAgo);

        appointment.startsAt = row.bookedAt;
        visit.checkedInAt = arrivedAt;
        if (seatedAt) visit.inChairAt = seatedAt;
        appointment.updatedAt = seatedAt ?? arrivedAt;
    }

    // --- the rest of today, and the days ahead ------------------------------

    const ahead: {
        minutes: number;
        patientIndex: number;
        lines: PlannedLine[];
        branch: BranchRow;
        needsLab?: boolean;
    }[] = [
        // Clear of the last arrival's slot, which runs to +40. Slots are
        // half-open and the overlap rule is per branch, so only the three on
        // `main` have to keep out of each other's way.
        { minutes: 45, patientIndex: 3, lines: [{ procedure: catalogue.checkup }], branch: main },
        {
            minutes: 85,
            patientIndex: 8,
            lines: [{ procedure: catalogue.extractionSurgical, tooth: 'LL8' }],
            branch: main,
        },
        { minutes: 125, patientIndex: 12, lines: [{ procedure: catalogue.cleaning }], branch: main },
        { minutes: 165, patientIndex: 14, lines: [{ procedure: catalogue.whitening }], branch: main },
        // The crown is still at the lab, so the reminder asks before it is sent.
        {
            minutes: 205,
            patientIndex: 9,
            lines: [{ procedure: catalogue.crownZirconia, tooth: 'UR1' }],
            branch: main,
            needsLab: true,
        },
    ];

    for (const booking of ahead) {
        appointmentHandlers.create({
            patient: { kind: 'existing', patientId: patient(booking.patientIndex).id },
            branchId: booking.branch.id,
            startsAt: at(booking.minutes).toISOString(),
            durationMinutes: 30,
            procedures: booking.lines.map((line) => ({
                procedureId: line.procedure.id,
                quantity: line.quantity ?? 1,
                tooth: line.tooth ?? null,
            })),
            needsLab: booking.needsLab,
            offsetMinutes: 0,
        });
    }

    for (let daysAhead = 1; daysAhead <= 6; daysAhead += 1) {
        const morning = new Date(instantAt(addDays(dateKey(Date.now()), daysAhead), 10 * 60));

        for (let slot = 0; slot < 2; slot += 1) {
            const index = (daysAhead * 2 + slot + 3) % patients.length;
            appointmentHandlers.create({
                patient: { kind: 'existing', patientId: patient(index).id },
                branchId: main.id,
                startsAt: new Date(morning.getTime() + slot * 90 * MINUTE).toISOString(),
                durationMinutes: 30,
                procedures: (history[(daysAhead + slot) % history.length] ?? []).map((line) => ({
                    procedureId: line.procedure.id,
                    quantity: line.quantity ?? 1,
                    tooth: line.tooth ?? null,
                })),
                offsetMinutes: 0,
            });
        }
    }

    // --- the week, widened to cover what was generated ----------------------

    // A weekday with no row is a closed day, and the demo must never open on
    // one. The window is taken from today's own appointments rather than from a
    // fixed pair of times, because those were placed around whatever hour this
    // is: a 9pm demo on 09:00–17:00 hours would open on a clinic that shut four
    // hours ago.
    const todayStamps = db.appointments
        .filter((row) => !row.isOpeningBalance && dateKey(row.startsAt) === dateKey(Date.now()))
        .map((row) => row.startsAt.getTime());

    // `now` is on the grid like the stamps are, so that the window is still on
    // it in the corner where now is the widest point — a seed run just after
    // midnight, whose earlier appointments all fall on yesterday.
    const now = at(0).getTime();
    const earliest = Math.min(...todayStamps, now);
    const latest = Math.max(...todayStamps, now);

    // Padded by whole multiples of the grid, and pinned to one: the hours are
    // what the slot picker draws its column against, so an 09:15 open puts
    // every slot in the demo back on a five.
    const opensAt = clampToDay(new Date(earliest - 50 * MINUTE), '00:00');

    // The pad runs past midnight for a demo opened late in the evening, and the
    // fallback it lands on is `23:50` — which is *behind* the clock between
    // 23:50 and 23:59, so the day view would open on a clinic that is closed.
    // Never earlier than now is what this file's header promises.
    const padded = clampToDay(new Date(latest + 90 * MINUTE), '23:50');
    const nowHhMm = clinicHhMm(Date.now());
    const closesAt = padded > nowHhMm ? padded : '23:59';

    // Late enough in the evening, the window runs past midnight at both ends
    // and both get pinned — which can leave opening after closing, and
    // `clinic_days` requires the opposite. Opening the day at midnight is the
    // answer that keeps `now` inside it.
    const opens = opensAt < closesAt ? opensAt : '00:00';

    // Every weekday at `main`, and never anywhere else. `clinic_days.weekday` is
    // the primary key — one branch per day, because the dentist cannot be in two
    // places at once — so the branch named here decides where the clinic *is*
    // that day, and a day view opened on any other branch reads as closed.
    // Spreading the week over both branches put today at Zamalek while the day
    // opens on Maadi, which is a demo that starts on "Closed on Tuesdays".
    // Zamalek stays in the register for the branch picker and holds nothing.
    for (let weekday = 0; weekday < 7; weekday += 1) {
        db.clinicDays.push({ weekday, branchId: main.id, opensAt: opens, closesAt });
    }

    return db;
}

/**
 * A time that ran past either end of *today* is pinned there. Opening hours are
 * `HH:MM` with no date on them, so a closing time of 00:57 tomorrow is not a
 * late night — read back as a time of day it is the small hours of the same
 * morning, and the clinic reads as shut all evening.
 *
 * Measured against today's midnight, never the clamped date's own: every date
 * falls inside its own day, so taking it from the argument is a bound that can
 * never be crossed, and an evening demo gets `00:57` as its closing time.
 */
function clampToDay(date: Date, fallback: string): string {
    const today = dateKey(Date.now());
    if (date.getTime() < instantAt(today, 0)) return fallback;
    if (date.getTime() >= instantAt(addDays(today, 1), 0)) return fallback;
    return clinicHhMm(date);
}
