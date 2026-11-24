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
    weekdayOf,
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

const GRID = 10 * MINUTE;

function at(offsetMinutes: number, from: number = Date.now()): Date {
    return new Date(Math.round((from + offsetMinutes * MINUTE) / GRID) * GRID);
}

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

function demoCost(defaultPrice: number): number {
    return Math.round((defaultPrice * 35) / 100 / 100) * 100;
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
        cost: demoCost(defaultPrice),
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
        birthDate,
        gender: null,
        custom: {},
        notes: null,
        legacyRef: index < 4 ? `OLD-${1200 + index}` : null,
        createdAt: new Date(createdFrom - (NAMES.length - index) * 21 * DAY),
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
            unitCost: line.procedure.cost,
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
        nextProcedures: [],
        nextAppointmentId: null,
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

function writeOpeningBalance(db: DemoDb, patient: PatientRow, branch: BranchRow, amount: number): void {
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
        nextProcedures: [],
        nextAppointmentId: null,
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
            const startsAt = new Date(midday.getTime() + slot * 90 * MINUTE);

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

    const PACE = [2, 1, 3, 2, 3, 1, 2, 3, 2, 1, 3, 2];
    const METHODS: PaymentMethod[] = ['cash', 'cash', 'visa', 'instapay'];
    for (let daysAgo = 365; daysAgo > 14; daysAgo -= 1) {
        const key = addDays(dateKey(Date.now()), -daysAgo);
        const weekday = weekdayOf(key);
        if (weekday === 5) continue;
        const branch = weekday % 2 === 0 ? main : second;
        const visits = PACE[Math.floor(daysAgo / 30) % PACE.length] ?? 2;
        const midday = new Date(instantAt(key, 11 * 60));

        for (let slot = 0; slot < visits; slot += 1) {
            writeClosedVisit(db, {
                patient: patient((daysAgo + slot) % patients.length),
                branch,
                startsAt: new Date(midday.getTime() + slot * 90 * MINUTE),
                durationMinutes: 30,
                lines: history[(daysAgo * 7 + slot) % history.length] ?? [],
                paid: 'full',
                method: METHODS[(daysAgo + slot) % METHODS.length] ?? 'cash',
            });
        }
    }

    writeOpeningBalance(db, patient(2), main, money(800));
    writeOpeningBalance(db, patient(9), main, money(1500));

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
        {
            patientIndex: 11,
            slotMinutes: -20,
            minutesAgo: 20,
            reach: 'waiting',
            lines: [{ procedure: catalogue.cleaning }],
        },
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

    const checkInAt = new Date();
    const seated = booked.map((appointment) => {
        const bookedAt = appointment.startsAt;
        appointment.startsAt = checkInAt;
        const visit = visitHandlers.checkIn({ appointmentId: appointment.id });
        return { appointment, visit, bookedAt };
    });

    for (const [index, arrival] of arrivals.entries()) {
        if (arrival.reach !== 'desk') continue;
        const row = seated[index];
        if (row) appointmentHandlers.awaitPayment({ id: row.appointment.id });
    }

    for (const [index, arrival] of arrivals.entries()) {
        const row = seated[index];
        if (!row) continue;

        const visit = db.visits.find((candidate) => candidate.id === row.visit.id);
        const appointment = db.appointments.find((candidate) => candidate.id === row.appointment.id);
        if (!visit || !appointment) continue;

        const arrivedAt = at(-arrival.minutesAgo);
        const seatedAt = arrival.seatedMinutesAgo === undefined ? null : at(-arrival.seatedMinutesAgo);

        appointment.startsAt = row.bookedAt;
        visit.checkedInAt = arrivedAt;
        if (seatedAt) visit.inChairAt = seatedAt;
        appointment.updatedAt = seatedAt ?? arrivedAt;
    }

    const ahead: {
        minutes: number;
        patientIndex: number;
        lines: PlannedLine[];
        branch: BranchRow;
        needsLab?: boolean;
    }[] = [
        { minutes: 45, patientIndex: 3, lines: [{ procedure: catalogue.checkup }], branch: main },
        {
            minutes: 85,
            patientIndex: 8,
            lines: [{ procedure: catalogue.extractionSurgical, tooth: 'LL8' }],
            branch: main,
        },
        { minutes: 125, patientIndex: 12, lines: [{ procedure: catalogue.cleaning }], branch: main },
        { minutes: 165, patientIndex: 14, lines: [{ procedure: catalogue.whitening }], branch: main },
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

    const todayStamps = db.appointments
        .filter((row) => !row.isOpeningBalance && dateKey(row.startsAt) === dateKey(Date.now()))
        .map((row) => row.startsAt.getTime());

    const now = at(0).getTime();
    const earliest = Math.min(...todayStamps, now);
    const latest = Math.max(...todayStamps, now);

    const opensAt = clampToDay(new Date(earliest - 50 * MINUTE), '00:00');

    const padded = clampToDay(new Date(latest + 90 * MINUTE), '23:50');
    const nowHhMm = clinicHhMm(Date.now());
    const closesAt = padded > nowHhMm ? padded : '23:59';

    const opens = opensAt < closesAt ? opensAt : '00:00';

    for (let weekday = 0; weekday < 7; weekday += 1) {
        db.clinicDays.push({ weekday, branchId: main.id, opensAt: opens, closesAt });
    }

    return db;
}

function clampToDay(date: Date, fallback: string): string {
    const today = dateKey(Date.now());
    if (date.getTime() < instantAt(today, 0)) return fallback;
    if (date.getTime() >= instantAt(addDays(today, 1), 0)) return fallback;
    return clinicHhMm(date);
}
