/**
 * Development seed exercising every state the UI renders. Destructive — deletes
 * every domain row before inserting, and refuses non-local databases unless
 * `--force` is passed. Prices are piastres (30_000 = 300 EGP). Times are
 * clinic-local via a fixed offset (CLINIC_OFFSET_MINUTES, Africa/Cairo summer);
 * omitting `visit.chargedTotal` charges the computed total (no discount).
 * Deletes run child-first; inserts put categories before their children for the
 * self-referencing `parent_id`.
 *
 * The hand-written bookings are the interesting ones — the awkward states the
 * UI has to render. A deterministic PRNG then fills the rest of the calendar so
 * the month reads like a working clinic: every open day of the current month
 * carries a full column, past ones settled, future ones booked with reminders
 * pending, and a few in next month so the calendar pages forward. The previous
 * month is generated too, and it is the only reason the money dashboard's
 * month-relative reads divide at all: a part-paid visit from last month whose
 * balance arrives in this one is exactly what `summary.olderCollected` counts,
 * and the ones that never come good are what `settle` allocates against. The
 * extra patient roster exists so lists paginate, search has to disambiguate,
 * and the revenue figures come from more than a handful of rows. The clinic
 * keeps the same hours everywhere, so a booking written for a wall-clock time
 * is inside opening hours whichever weekday the seed happens to run on, and a
 * booking's branch is whichever one is open that day rather than the one
 * written down.
 *
 * Today is the exception and is written against the clock rather than the wall
 * (`ago`). A state that means "right now" — in the chair, at the desk, waiting —
 * is a lie at any fixed hour but the one the seed happens to be run at, and the
 * lie is not harmless: a check-in stamped for later today gives the chair a
 * progress bar that cannot start and a queue ordered by a time that has not
 * come. Today's generated column divides at the clock too, so the morning is
 * settled and the afternoon is still booked whenever you run it.
 *
 * A booking's planned procedures (§7) come from `plan`; `type` is the
 * one-procedure shorthand the older fixtures use. A tooth-specific procedure
 * needs a tooth to satisfy §5, so the shorthand reuses the tooth the visit
 * actually recorded — the plan and the outcome agree — and falls back to a
 * fixed tooth for bookings that never reached the chair.
 *
 *   bun packages/server/scripts/seed.ts
 */

import {
    type AppointmentChannel,
    type AppointmentStatus,
    DEFAULT_DURATION_MINUTES,
    DEFAULT_REMINDER_LEAD_HOURS,
    DEFAULT_REMINDER_TEMPLATE,
    type PaymentMethod,
    type Tooth,
} from '@lustre/shared';
import { config } from '../src/config.ts';
import { databaseEnvironment } from '../src/db/environment.ts';
import { db, sql } from '../src/db/index.ts';
import {
    appointmentProcedures,
    appointments,
    branches,
    clinicDays,
    customQuestions,
    patients,
    payments,
    procedureTypes,
    reminders,
    settings,
    visitProcedures,
    visits,
} from '../src/db/schema.ts';
import { logger } from '../src/logger.ts';
import { seedService } from '../src/modules/seed/seed.service.ts';
import { buildRef } from '../src/util/ref.ts';

const CLINIC_OFFSET_MINUTES = 180;

const id = () => Bun.randomUUIDv7();

const todayLocalMidnight = (() => {
    const now = new Date();
    const local = new Date(now.getTime() + CLINIC_OFFSET_MINUTES * 60_000);
    const utcMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return new Date(utcMidnight - CLINIC_OFFSET_MINUTES * 60_000);
})();

function at(dayOffset: number, hhmm: string): Date {
    const [hours, minutes] = hhmm.split(':').map(Number);
    return new Date(
        todayLocalMidnight.getTime() +
            dayOffset * 86_400_000 +
            (hours ?? 0) * 3_600_000 +
            (minutes ?? 0) * 60_000,
    );
}

/** The whole minute the seed was run in, which today is measured back from. */
const seedMinute = Math.floor(Date.now() / 60_000) * 60_000;

/**
 * A time relative to the moment the seed runs, rounded to the minute.
 *
 * Today's live fixtures — the patient in the chair, the one at the desk, the one
 * still waiting — cannot be written as wall-clock times. `at(0, '10:58')` seeded
 * at half past eight is a check-in two hours in the future, which is a state the
 * clinic cannot produce and the app has no sensible way to draw: a bar that
 * cannot start, a queue ordered by a clock that has not struck. It cost two
 * false bug reports before anyone looked at the seed.
 *
 * So the live end of today is written as "twenty minutes ago" and lands wherever
 * the seed happens to run. Negative goes forwards, for the things that have not
 * happened yet.
 */
function ago(minutes: number): Date {
    return new Date(seedMinute - minutes * 60_000);
}

/**
 * The same, snapped to the five-minute grid the desk books on.
 *
 * `ago` inherits whatever minute the seed was run at, which is right for things
 * that *happened* — a check-in at 09:33 is a fact — and wrong for a slot, which
 * is a time somebody said out loud on the phone. Run at 09:39 the plain helper
 * books people at 09:54 and 10:24, and because the generated column steps over
 * the hand-written rows the skew spreads: the whole afternoon lands on 10:17,
 * 11:22, 12:07. Nobody says twenty-two past eleven.
 *
 * So slots round and stamps do not. The exception is a walk-in, which is not a
 * slot anyone chose — `makeRoomForWalkIn` gives it the exact end of whatever is
 * in the chair, and the fixture copies that rather than rounding.
 */
function slotAgo(minutes: number): Date {
    return new Date(Math.round((seedMinute - minutes * 60_000) / 300_000) * 300_000);
}

/** Minutes since local midnight at the moment the seed runs. */
const nowLocalMinutes = Math.floor((Date.now() - todayLocalMidnight.getTime()) / 60_000);

function isLocalDatabase(url: string): boolean {
    try {
        const { hostname } = new URL(url);
        return (
            hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'db' || hostname === '::1'
        );
    } catch {
        return false;
    }
}

if (!isLocalDatabase(config.DATABASE_URL) && !process.argv.includes('--force')) {
    logger.error('refusing to seed a non-local database; pass --force if that is really what you want');
    process.exit(1);
}

// `db` is local by the check above, and it is also the production database's
// hostname inside the clinic stack. The marker on the database is what tells
// them apart, and no flag overrides it.
if ((await databaseEnvironment(sql)) === 'production') {
    logger.error('refusing to seed the production database: the seed deletes every row');
    await sql.end();
    process.exit(1);
}

const mainBranch = {
    id: id(),
    name: 'Nasr City',
    address: '12 Abbas El Akkad, Nasr City, Cairo',
    active: true,
};
const secondBranch = { id: id(), name: 'Maadi', address: '9 Road 9, Maadi, Cairo', active: true };
const oldBranch = { id: id(), name: 'Heliopolis (closed)', address: null, active: false };

const days = [
    { weekday: 0, branchId: mainBranch.id, opensAt: '10:00', closesAt: '18:00' },
    { weekday: 1, branchId: mainBranch.id, opensAt: '10:00', closesAt: '18:00' },
    { weekday: 2, branchId: secondBranch.id, opensAt: '10:00', closesAt: '18:00' },
    { weekday: 3, branchId: mainBranch.id, opensAt: '10:00', closesAt: '18:00' },
    { weekday: 4, branchId: secondBranch.id, opensAt: '10:00', closesAt: '18:00' },
];

const cat = (name: string, sortOrder: number) => ({
    id: id(),
    parentId: null,
    name,
    defaultPrice: 0,
    cost: 0,
    hasQuantity: false,
    isToothSpecific: false,
    isCheckup: false,
    active: true,
    sortOrder,
});

const checkupCat = cat('Checkups', 0);
const restorativeCat = cat('Restorative', 1);
const surgicalCat = cat('Surgical', 2);
const cosmeticCat = cat('Cosmetic', 3);

const proc = (
    parent: { id: string },
    name: string,
    defaultPrice: number,
    opts: { tooth?: boolean; quantity?: boolean; checkup?: boolean; active?: boolean } = {},
    sortOrder = 0,
) => ({
    id: id(),
    parentId: parent.id,
    name,
    defaultPrice,
    // About a third of the price in whole pounds, so the stats screen has a
    // margin to show.
    cost: Math.round((defaultPrice * 35) / 100 / 100) * 100,
    hasQuantity: opts.quantity ?? false,
    isToothSpecific: opts.tooth ?? false,
    isCheckup: opts.checkup ?? false,
    active: opts.active ?? true,
    sortOrder,
});

const consultation = proc(checkupCat, 'Consultation', 30_000, { checkup: true }, 0);
const followUp = proc(checkupCat, 'Follow-up', 15_000, { checkup: true }, 1);
const xray = proc(checkupCat, 'Periapical x-ray', 20_000, { tooth: true, quantity: true }, 2);
const filling = proc(restorativeCat, 'Composite filling', 90_000, { tooth: true }, 0);
const rootCanal = proc(restorativeCat, 'Root canal treatment', 350_000, { tooth: true }, 1);
const crown = proc(restorativeCat, 'Zirconia crown', 600_000, { tooth: true }, 2);
const extraction = proc(surgicalCat, 'Simple extraction', 120_000, { tooth: true }, 0);
const surgicalExtraction = proc(surgicalCat, 'Surgical extraction', 250_000, { tooth: true }, 1);
const scaling = proc(cosmeticCat, 'Scaling and polishing', 80_000, {}, 0);
const whitening = proc(cosmeticCat, 'In-office whitening', 450_000, { active: false }, 1);

const procedures = [
    checkupCat,
    restorativeCat,
    surgicalCat,
    cosmeticCat,
    consultation,
    followUp,
    xray,
    filling,
    rootCanal,
    crown,
    extraction,
    surgicalExtraction,
    scaling,
    whitening,
];

const questions = [
    {
        id: id(),
        key: 'referral',
        label: 'How did you hear about us?',
        labelAr: 'كيف سمعت عنا؟',
        kind: 'select' as const,
        options: ['Friend', 'Instagram', 'Walk-by', 'Other'],
        required: false,
        sortOrder: 0,
        active: true,
    },
    {
        id: id(),
        key: 'allergies',
        label: 'Allergies',
        labelAr: 'الحساسية',
        kind: 'text' as const,
        options: null,
        required: false,
        sortOrder: 1,
        active: true,
    },
    {
        id: id(),
        key: 'diabetic',
        label: 'Diabetic?',
        labelAr: 'هل تعاني من السكري؟',
        kind: 'boolean' as const,
        options: null,
        required: true,
        sortOrder: 2,
        active: true,
    },
    // The rest are English-only, as a real clinic's back half usually is —
    // they exercise the fallback in `resolveLabel` on an Arabic phone.
    {
        id: id(),
        key: 'last_visit_elsewhere',
        label: 'Last dental visit elsewhere',
        kind: 'date' as const,
        options: null,
        required: false,
        sortOrder: 3,
        active: true,
    },
    {
        id: id(),
        key: 'systolic',
        label: 'Systolic BP',
        kind: 'number' as const,
        options: null,
        required: false,
        sortOrder: 4,
        active: true,
    },
    {
        id: id(),
        key: 'insurer',
        label: 'Insurer',
        kind: 'text' as const,
        options: null,
        required: false,
        sortOrder: 5,
        active: false,
    },
];

// Seeded patients are numbered the way the service numbers them, and the
// settings row below is left pointing at the number after the last of them, so
// the first patient registered after a seed carries on from there.
let lastPatientRef = 0;

function seedPatientRef(): string {
    lastPatientRef += 1;
    return String(lastPatientRef);
}

const patient = (
    name: string,
    phone: string,
    extra: Partial<{
        email: string | null;
        birthDate: string;
        gender: string | null;
        custom: Record<string, unknown>;
        notes: string | null;
        createdAt: Date;
    }> = {},
) => ({
    id: id(),
    ref: seedPatientRef(),
    name,
    phone,
    email: extra.email ?? null,
    birthDate: extra.birthDate ?? '1990-06-15',
    gender: extra.gender ?? null,
    custom: extra.custom ?? {},
    notes: extra.notes ?? null,
    createdAt: extra.createdAt ?? at(-120, '11:00'),
});

const nour = patient('Nour Abdelrahman', '+201001234567', {
    email: 'nour.abdelrahman@example.com',
    birthDate: '1991-04-12',
    gender: 'female',
    custom: { referral: 'Instagram', allergies: 'Penicillin', diabetic: false, systolic: 118 },
    notes: 'Prefers morning slots.',
});
const kareem = patient('Kareem Hassanein', '+201115550101', {
    email: 'kareem.h@example.com',
    birthDate: '1978-11-30',
    gender: 'male',
    custom: {
        referral: 'Friend',
        allergies: '',
        diabetic: true,
        last_visit_elsewhere: '2023-06-02',
        systolic: 145,
    },
    notes: 'Type 2 diabetic — confirm HbA1c before any extraction.',
});
const sara = patient('Sara Elmasry', '+201227778899', { createdAt: at(-2, '09:40') });
const yassin = patient('Yassin Tarek', '+201006661212', {
    birthDate: '2019-09-08',
    gender: 'male',
    custom: { referral: 'Friend', diabetic: false },
    notes: 'Comes with his mother. Nervous in the chair.',
});
const mona = patient('Mona Farid', '+201503334455', {
    email: 'mona.farid@example.com',
    birthDate: '1965-02-19',
    gender: 'female',
    custom: { referral: 'Walk-by', diabetic: false, systolic: 132 },
});
const omar = patient('Omar Sedky', '+201098765432', {
    birthDate: '2001-07-25',
    gender: 'male',
    custom: { referral: 'Instagram', diabetic: false },
});
const hoda = patient('Hoda Naguib', '+201212121212', { birthDate: '1988-01-03', gender: 'female' });
const laila = patient('Laila Mostafa', '+201555443322', {
    email: 'laila.m@example.com',
    gender: 'female',
    custom: { referral: 'Other', diabetic: false },
    createdAt: at(0, '09:15'),
});
const monaSecond = patient('Mona Abdelaziz', '+201004445566', { birthDate: '1995-12-01', gender: 'female' });

const roster = [
    ['Ahmed Zaki', '+201004001001', 'male', '1983-03-17'],
    ['Aya Mahmoud', '+201004001002', 'female', '1996-08-22'],
    ['Bassem Ghali', '+201004001003', 'male', '1971-05-05'],
    ['Dalia Sherif', '+201004001004', 'female', '1990-01-29'],
    ['Eslam Fathy', '+201004001005', 'male', '1999-10-14'],
    ['Farida Nabil', '+201004001006', 'female', '2005-06-30'],
    ['Gamal Roshdy', '+201004001007', 'male', '1958-12-11'],
    ['Habiba Selim', '+201004001008', 'female', '1993-02-08'],
    ['IbrahimShafik', '+201004001009', 'male', '1986-07-19'],
    ['Jailan Ezzat', '+201004001010', 'female', '2000-04-02'],
    ['Karim Nagy', '+201004001011', 'male', '1994-11-23'],
    ['Lamia Wahba', '+201004001012', 'female', '1969-09-01'],
    ['Mahmoud Sobhy', '+201004001013', 'male', '1981-06-16'],
    ['Nadia Kamel', '+201004001014', 'female', '1975-03-27'],
    ['Osama Rifaat', '+201004001015', 'male', '2003-01-09'],
    ['Passant Adel', '+201004001016', 'female', '1998-12-05'],
    ['Ramy Guindy', '+201004001017', 'male', '1989-04-21'],
    ['Salma Anis', '+201004001018', 'female', '2012-10-03'],
    ['Tarek Halim', '+201004001019', 'male', '1962-08-13'],
    ['Rana Bahgat', '+201004001020', 'female', '1997-05-26'],
    ['Wael Mansour', '+201004001021', 'male', '1979-02-14'],
    ['Yara Fahmy', '+201004001022', 'female', '2008-07-07'],
    ['Ziad Okasha', '+201004001023', 'male', '1992-09-18'],
    ['Amira Rashad', '+201004001024', 'female', '1985-11-11'],
    ['Hesham Bakr', '+201004001025', 'male', '1973-01-31'],
    ['Injy Shokry', '+201004001026', 'female', '2001-03-06'],
    ['Marwan Sabry', '+201004001027', 'male', '1996-06-24'],
    ['Nourhan Ismail', '+201004001028', 'female', '1991-10-09'],
    ['Mona Abdelrahman', '+201004001029', 'female', '1988-04-04'],
    ['Kareem Hassan', '+201004001030', 'male', '1984-12-19'],
    ['Omar Sedky', '+201004001031', 'male', '1966-02-02'],
] as const;

const rosterPatients = roster.map(([name, phone, gender, birthDate], index) =>
    patient(name, phone, {
        gender,
        birthDate,
        email: index % 3 === 0 ? `${name.split(' ')[0]?.toLowerCase()}.${index}@example.com` : null,
        custom:
            index % 4 === 0
                ? { referral: 'Friend', diabetic: false }
                : index % 4 === 1
                  ? { referral: 'Instagram', diabetic: false, systolic: 115 + (index % 30) }
                  : index % 4 === 2
                    ? { referral: 'Walk-by', diabetic: index % 8 === 2, allergies: 'Latex' }
                    : {},
        notes: index % 7 === 0 ? 'Referred by a family member.' : null,
        createdAt: at(-320 + index * 9, '11:00'),
    }),
);

const allPatients = [nour, kareem, sara, yassin, mona, omar, hoda, laila, monaSecond, ...rosterPatients];

interface Line {
    procedure: { id: string; defaultPrice: number; cost: number };
    quantity?: number;
    unitPrice?: number;
    tooth?: Tooth;
    note?: string;
}

interface Booking {
    patient: { id: string };
    branch: { id: string };
    startsAt: Date;
    durationMinutes?: number;
    type?: { id: string; isToothSpecific: boolean };
    plan?: {
        procedure: { id: string; isToothSpecific: boolean };
        quantity?: number;
        tooth?: Tooth;
        note?: string;
    }[];
    status: AppointmentStatus;
    channel?: AppointmentChannel;
    note?: string;
    /**
     * Built by `seedService` through the real services instead of inserted.
     *
     * Only today's live states carry this — in the chair, at the desk, waiting.
     * They stay in this array so the generator still reserves their slots and
     * routes around them, and are skipped when the rows are written.
     *
     * They carry no `visit`, deliberately. Check-in builds it, including the
     * lines it copies off the plan, and a `visit` sitting here would be dead
     * data that reads like the source of truth — which is how a checked-in
     * patient ended up with a booking that planned a Consultation and a visit
     * that recorded nothing. `status` is what `reach` should produce, and is
     * the interface's, not this walk's.
     */
    live?: { reach: 'waiting' | 'chair' | 'desk'; arrivedAgo: number; seatedAgo?: number };
    visit?: {
        checkedInAt: Date;
        /**
         * When they reached the chair. Left out means they walked into an empty
         * one and it is the arrival; `null` means they are still queueing, which
         * only the hand-written fixtures need — the generated days never put two
         * patients in the chair at once.
         */
        inChairAt?: Date | null;
        completedAt?: Date;
        chargedTotal?: number;
        lines: Line[];
        payments?: { amount: number; method: PaymentMethod; methodNote?: string; paidAt: Date }[];
    };
    reminder?: { status: 'pending' | 'sent' | 'skipped'; sentAt?: Date };
}

// The chair's booked span today, named because the walk-in behind it is defined
// as its end rather than as a time of its own.
const CHAIR_STARTS_AT = slotAgo(40);
const CHAIR_MINUTES = 45;

const bookings: Booking[] = [
    {
        patient: kareem,
        branch: mainBranch,
        startsAt: at(-7, '10:30'),
        durationMinutes: 45,
        type: rootCanal,
        status: 'done',
        visit: {
            checkedInAt: at(-7, '10:26'),
            completedAt: at(-7, '11:20'),
            lines: [
                { procedure: consultation },
                { procedure: xray, quantity: 2, tooth: 'LR6' },
                { procedure: rootCanal, tooth: 'LR6', note: 'Session 1 of 2.' },
            ],
            payments: [{ amount: 400_000, method: 'visa', paidAt: at(-7, '11:22') }],
        },
    },
    {
        patient: mona,
        branch: mainBranch,
        startsAt: at(-7, '12:00'),
        durationMinutes: 30,
        type: scaling,
        status: 'done',
        visit: {
            checkedInAt: at(-7, '11:58'),
            completedAt: at(-7, '12:35'),
            lines: [{ procedure: scaling }, { procedure: consultation }],
            payments: [
                { amount: 60_000, method: 'cash', paidAt: at(-7, '12:36') },
                { amount: 50_000, method: 'instapay', paidAt: at(-5, '19:04') },
            ],
        },
    },
    {
        patient: yassin,
        branch: mainBranch,
        startsAt: at(-6, '11:00'),
        durationMinutes: 20,
        type: filling,
        status: 'done',
        note: 'Mother asked for the family rate.',
        visit: {
            checkedInAt: at(-6, '11:05'),
            completedAt: at(-6, '11:30'),
            chargedTotal: 90_000,
            lines: [
                { procedure: consultation },
                { procedure: filling, tooth: 'ULD', note: 'Deciduous, glass ionomer.' },
            ],
            payments: [{ amount: 90_000, method: 'cash', paidAt: at(-6, '11:31') }],
        },
    },
    {
        patient: omar,
        branch: secondBranch,
        startsAt: at(-5, '13:00'),
        durationMinutes: 60,
        type: crown,
        status: 'done',
        visit: {
            checkedInAt: at(-5, '13:10'),
            completedAt: at(-5, '14:15'),
            lines: [
                { procedure: crown, tooth: 'UR4' },
                { procedure: xray, tooth: 'UR4' },
            ],
            payments: [{ amount: 300_000, method: 'cash', paidAt: at(-5, '14:16') }],
        },
    },
    {
        patient: sara,
        branch: secondBranch,
        startsAt: at(-2, '12:30'),
        durationMinutes: 30,
        type: extraction,
        status: 'done',
        channel: 'walk_in',
        visit: {
            checkedInAt: at(-2, '12:28'),
            completedAt: at(-2, '13:05'),
            lines: [{ procedure: extraction, tooth: 'LL8' }, { procedure: consultation }],
        },
    },
    {
        patient: monaSecond,
        branch: mainBranch,
        startsAt: at(-3, '15:00'),
        durationMinutes: 30,
        type: followUp,
        status: 'done',
        visit: {
            checkedInAt: at(-3, '15:02'),
            completedAt: at(-3, '15:25'),
            lines: [{ procedure: followUp }],
            payments: [
                { amount: 15_000, method: 'other', methodNote: 'Bank transfer', paidAt: at(-3, '15:26') },
            ],
        },
    },
    { patient: hoda, branch: mainBranch, startsAt: at(-4, '16:00'), type: consultation, status: 'no_show' },
    {
        patient: nour,
        branch: mainBranch,
        startsAt: at(-4, '17:00'),
        type: scaling,
        status: 'cancelled',
        note: 'Cancelled the night before, travelling.',
    },

    // Today's live end, written relative to the moment the seed runs (`ago`).
    // Read down and it is one morning in order: Mona has been and gone, Nour is
    // at the desk paying, Kareem is in the chair she got up from, Laila walked
    // in and is waiting, and three more are still to come.
    //
    // The three states in the middle are the ones worth having: `in_chair_at`
    // differs from `checked_in_at` on Kareem (he queued behind Nour) and is null
    // on Laila (she has arrived and is not seated). Both are invisible on a
    // fixture where everyone walks into an empty chair.
    {
        patient: mona,
        branch: mainBranch,
        startsAt: slotAgo(150),
        durationMinutes: 30,
        type: followUp,
        status: 'done',
        visit: {
            checkedInAt: ago(155),
            inChairAt: ago(150),
            completedAt: ago(122),
            lines: [{ procedure: followUp }],
            payments: [{ amount: 15_000, method: 'cash', paidAt: ago(121) }],
        },
    },
    {
        patient: nour,
        branch: mainBranch,
        startsAt: slotAgo(95),
        durationMinutes: 30,
        type: filling,
        status: 'awaiting_payment',
        live: { reach: 'desk', arrivedAgo: 100, seatedAgo: 95 },
    },
    {
        patient: kareem,
        branch: mainBranch,
        startsAt: CHAIR_STARTS_AT,
        durationMinutes: CHAIR_MINUTES,
        type: rootCanal,
        status: 'checked_in',
        note: 'Session 2 of 2.',
        // Twenty minutes of waiting room before the chair, so the bar reads
        // twelve minutes rather than thirty-two. This is the fixture
        // `in_chair_at` exists for.
        live: { reach: 'chair', arrivedAgo: 32, seatedAgo: 12 },
    },
    {
        patient: laila,
        branch: mainBranch,
        // Only a slot reservation: `walkIn` works out the real time — the
        // moment she arrives, or the end of whatever is in the chair — and
        // cascades anything it displaces. Holding the space here just keeps the
        // generated column from filling it and being pushed straight back out.
        startsAt: new Date(CHAIR_STARTS_AT.getTime() + CHAIR_MINUTES * 60_000),
        durationMinutes: 20,
        type: consultation,
        status: 'checked_in',
        channel: 'walk_in',
        // Second in the queue behind Kareem: arrived, not seated, and the one
        // fixture that leaves `in_chair_at` null.
        live: { reach: 'waiting', arrivedAgo: 6 },
    },
    {
        patient: omar,
        branch: mainBranch,
        startsAt: slotAgo(-45),
        durationMinutes: 30,
        type: crown,
        status: 'booked',
        reminder: { status: 'sent', sentAt: at(-1, '19:02') },
    },
    {
        patient: sara,
        branch: mainBranch,
        startsAt: slotAgo(-90),
        durationMinutes: 20,
        type: followUp,
        status: 'booked',
        reminder: { status: 'skipped' },
    },
    {
        patient: yassin,
        branch: mainBranch,
        startsAt: slotAgo(-135),
        durationMinutes: 20,
        type: consultation,
        status: 'booked',
        note: 'Bring the panoramic from last year.',
        reminder: { status: 'sent', sentAt: at(-1, '19:03') },
    },
    { patient: hoda, branch: mainBranch, startsAt: slotAgo(-180), type: consultation, status: 'cancelled' },

    {
        patient: nour,
        branch: mainBranch,
        startsAt: at(1, '10:00'),
        durationMinutes: 45,
        plan: [
            { procedure: consultation },
            { procedure: xray, quantity: 2, tooth: 'UL4' },
            { procedure: crown, tooth: 'UL4', note: 'Shade taken at the consult.' },
        ],
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: monaSecond,
        branch: mainBranch,
        startsAt: at(1, '11:00'),
        type: scaling,
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: kareem,
        branch: mainBranch,
        startsAt: at(1, '12:00'),
        durationMinutes: 20,
        type: followUp,
        status: 'booked',
        reminder: { status: 'sent', sentAt: at(0, '19:01') },
    },

    {
        patient: sara,
        branch: secondBranch,
        startsAt: at(2, '12:00'),
        durationMinutes: 30,
        type: consultation,
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: omar,
        branch: secondBranch,
        startsAt: at(2, '12:30'),
        durationMinutes: 30,
        plan: [
            { procedure: filling, tooth: 'LL6' },
            { procedure: filling, tooth: 'LL7' },
        ],
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: mona,
        branch: secondBranch,
        startsAt: at(2, '13:00'),
        durationMinutes: 30,
        type: filling,
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: yassin,
        branch: secondBranch,
        startsAt: at(2, '13:30'),
        durationMinutes: 30,
        type: followUp,
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: hoda,
        branch: secondBranch,
        startsAt: at(2, '14:00'),
        durationMinutes: 60,
        type: surgicalExtraction,
        status: 'booked',
        reminder: { status: 'pending' },
    },

    {
        patient: kareem,
        branch: mainBranch,
        startsAt: at(4, '10:00'),
        durationMinutes: 60,
        type: crown,
        status: 'booked',
        reminder: { status: 'pending' },
    },
    {
        patient: laila,
        branch: mainBranch,
        startsAt: at(9, '16:00'),
        durationMinutes: 45,
        type: rootCanal,
        status: 'booked',
        note: 'First treatment appointment.',
        reminder: { status: 'pending' },
    },
];

let randomState = 0x9e3779b9;
function random(): number {
    randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0;
    return randomState / 0x1_0000_0000;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

function localWeekday(dayOffset: number): number {
    return new Date(at(dayOffset, '00:00').getTime() + CLINIC_OFFSET_MINUTES * 60_000).getUTCDay();
}

const generatedRange = (() => {
    const local = new Date(todayLocalMidnight.getTime() + CLINIC_OFFSET_MINUTES * 60_000);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth();
    const dayOfMonth = local.getUTCDate();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const daysInPreviousMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
        first: 1 - dayOfMonth,
        last: daysInMonth - dayOfMonth,
        previousFirst: 1 - dayOfMonth - daysInPreviousMonth,
        previousLast: -dayOfMonth,
    };
})();

const isOpen = (dayOffset: number) => days.some((d) => d.weekday === localWeekday(dayOffset));

/**
 * When a balance carried over from last month was actually handed across the
 * desk: an open day of the current month, at or before today, inside opening
 * hours. Dating it in the future would still fall inside the month `summary`
 * asks for, and would read as money the clinic has not been given yet.
 */
function latePaymentDate(): Date {
    const span = -generatedRange.first;
    let offset = generatedRange.first + Math.floor(random() * (span + 1));
    for (let tries = 0; tries < 7 && !isOpen(offset); tries += 1) {
        offset = offset === 0 ? generatedRange.first : offset + 1;
    }
    const hour = 10 + Math.floor(random() * 8);
    const minute = Math.floor(random() * 12) * 5;
    return at(offset, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
}

const treatments = [
    { type: consultation, minutes: 20, lines: [{ procedure: consultation }] },
    { type: followUp, minutes: 20, lines: [{ procedure: followUp }] },
    { type: scaling, minutes: 30, lines: [{ procedure: scaling }] },
    { type: filling, minutes: 30, lines: [{ procedure: consultation }, { procedure: filling }] },
    { type: extraction, minutes: 30, lines: [{ procedure: extraction }, { procedure: xray }] },
    { type: rootCanal, minutes: 45, lines: [{ procedure: consultation }, { procedure: rootCanal }] },
    { type: crown, minutes: 60, lines: [{ procedure: crown }, { procedure: xray }] },
    {
        type: surgicalExtraction,
        minutes: 60,
        lines: [{ procedure: surgicalExtraction }, { procedure: xray }],
    },
] as const;

const teeth: Tooth[] = ['UR6', 'UR4', 'UL5', 'UL7', 'LL6', 'LL8', 'LR6', 'LR4', 'ULD', 'LRE'];
const cashMethods: PaymentMethod[] = ['cash', 'cash', 'visa', 'instapay'];

function generateDay(dayOffset: number, dense = false, maxBookings = Number.POSITIVE_INFINITY): void {
    const weekday = localWeekday(dayOffset);
    const day = days.find((d) => d.weekday === weekday);
    if (!day) return; // Friday and Saturday: shut.

    const branch = day.branchId === mainBranch.id ? mainBranch : secondBranch;
    const [openHour] = day.opensAt.split(':').map(Number);
    const [closeHour] = day.closesAt.split(':').map(Number);
    const past = dayOffset < 0;

    /**
     * Today divides at the clock, not at midnight. A 10:00 slot seeded at three
     * in the afternoon is not something the clinic is still expecting — leaving
     * the whole of today `booked` drew a column of appointments hours overdue
     * and a "before this" section with nothing in it.
     */
    const settledBy = (endMinute: number) => past || (dayOffset === 0 && endMinute <= nowLocalMinutes);

    // Days don't all start dead on the hour, but the desk books on a five-minute
    // grid — a 10:41 start is a time nobody would say out loud.
    let minute = (openHour ?? 10) * 60 + (dense || dayOffset === 0 ? 0 : Math.floor(random() * 6) * 5);
    const closingMinute = (closeHour ?? 18) * 60;

    const dayStart = at(dayOffset, '00:00').getTime();
    const takenSlots = bookings
        .filter((b) => b.startsAt.getTime() >= dayStart && b.startsAt.getTime() < dayStart + 86_400_000)
        .map((b) => {
            const start = (b.startsAt.getTime() - dayStart) / 60_000;
            return { start, end: start + (b.durationMinutes ?? DEFAULT_DURATION_MINUTES) };
        })
        .sort((a, b) => a.start - b.start);

    let placed = 0;
    while (minute + 20 <= closingMinute && placed < maxBookings) {
        // The start can land inside a booking that began earlier — the jittered
        // opening, or a hand-written appointment mid-visit. `nextTaken` only
        // sees slots starting from here on, so step over that one first.
        const covering = takenSlots.find((slot) => slot.start <= minute && minute < slot.end);
        if (covering) {
            minute = covering.end;
            continue;
        }

        const nextTaken = takenSlots
            .filter((slot) => slot.start >= minute)
            .reduce((soonest, slot) => Math.min(soonest, slot.start), closingMinute);
        const room = nextTaken - minute;

        const treatment = dense
            ? pick(treatments.filter((t) => t.minutes <= room && t.minutes <= 30))
            : pick(treatments.filter((t) => t.minutes <= room));

        if (!treatment) {
            const blocker = takenSlots.find((slot) => slot.start === nextTaken);
            minute = blocker ? blocker.end : closingMinute;
            continue;
        }

        const startsAt = at(
            dayOffset,
            `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
        );
        takenSlots.push({ start: minute, end: minute + treatment.minutes });

        const who = pick(allPatients);
        const lines: Line[] = treatment.lines.map((line) => ({
            procedure: line.procedure,
            tooth: line.procedure.isToothSpecific ? pick(teeth) : undefined,
        }));
        const roll = random();
        const settled = settledBy(minute + treatment.minutes);

        if (settled) {
            if (!dense && roll < 0.06) {
                bookings.push({
                    patient: who,
                    branch,
                    startsAt,
                    durationMinutes: treatment.minutes,
                    type: treatment.type,
                    status: 'no_show',
                });
            } else if (!dense && roll < 0.11) {
                bookings.push({
                    patient: who,
                    branch,
                    startsAt,
                    durationMinutes: treatment.minutes,
                    type: treatment.type,
                    status: 'cancelled',
                });
            } else {
                const total = lines.reduce((sum, line) => sum + line.procedure.defaultPrice, 0);
                const charged = roll > 0.9 ? Math.round((total * 0.85) / 1_000) * 1_000 : total;
                const paid = roll < 0.2 ? Math.round((charged * 0.5) / 1_000) * 1_000 : charged;
                const visitPayments =
                    paid > 0
                        ? [
                              {
                                  amount: paid,
                                  method: pick(cashMethods),
                                  methodNote: undefined,
                                  paidAt: new Date(startsAt.getTime() + (treatment.minutes + 2) * 60_000),
                              },
                          ]
                        : [];

                // The balance on a visit from before this month, handed over
                // inside it. This is the whole of `summary.olderCollected`:
                // payment date in the range, visit date before it. The third
                // that is never settled is what the outstanding report carries
                // and what `settle` fills first.
                if (dayOffset < generatedRange.first && paid < charged && random() < 0.66) {
                    visitPayments.push({
                        amount: charged - paid,
                        method: pick(cashMethods),
                        methodNote: undefined,
                        paidAt: latePaymentDate(),
                    });
                }

                bookings.push({
                    patient: who,
                    branch,
                    startsAt,
                    durationMinutes: treatment.minutes,
                    type: treatment.type,
                    status: 'done',
                    channel: roll > 0.94 ? 'walk_in' : 'desk',
                    visit: {
                        checkedInAt: new Date(startsAt.getTime() - 4 * 60_000),
                        completedAt: new Date(startsAt.getTime() + treatment.minutes * 60_000),
                        chargedTotal: charged,
                        lines,
                        payments: visitPayments,
                    },
                    reminder: { status: 'sent', sentAt: new Date(startsAt.getTime() - 20 * 3_600_000) },
                });
            }
        } else {
            bookings.push({
                patient: who,
                branch,
                startsAt,
                durationMinutes: treatment.minutes,
                type: treatment.type,
                status: !dense && roll < 0.05 ? 'cancelled' : 'booked',
                reminder: {
                    status: dayOffset <= 1 ? 'sent' : 'pending',
                    sentAt: dayOffset <= 1 ? at(-1, '19:00') : undefined,
                },
            });
        }

        placed += 1;
        minute += treatment.minutes + (!dense && random() < 0.25 ? 10 : 0);
    }
}

const fullDays = new Set([-6, 0, 1, 8]);

const quietDays = new Map([
    [-8, 2],
    [-1, 3],
    [2, 2],
    [5, 3],
    [9, 1],
    [12, 2],
    [16, 3],
]);

for (let offset = generatedRange.first; offset <= generatedRange.last; offset += 1) {
    if (offset === 3) continue;
    generateDay(offset, fullDays.has(offset), quietDays.get(offset) ?? Number.POSITIVE_INFINITY);
}

let scheduledNextMonth = 0;
for (
    let offset = generatedRange.last + 1;
    scheduledNextMonth < 4 && offset <= generatedRange.last + 25;
    offset += 3
) {
    const before = bookings.length;
    generateDay(offset);
    if (bookings.length > before) scheduledNextMonth += 1;
}

// Last, deliberately: the PRNG is a single stream, so generating the previous
// month here rather than in date order leaves every day already in the seed
// byte-for-byte what it was before this month straddled the boundary.
for (let offset = generatedRange.previousFirst; offset <= generatedRange.previousLast; offset += 1) {
    generateDay(offset);
}

// A year before that, thinner than the two months the screens open on, so the
// stats screen has months, weeks and a previous year to compare. Each month
// takes a different cap on its days so the line has a shape rather than a
// plateau. After everything else for the same reason as the month above.
const HISTORY_DAYS = 335;
const MONTHLY_CAP = [6, 4, 7, 5, 8, 6, 3, 7, 5, 8, 6, 4];
for (let back = 1; back <= HISTORY_DAYS; back += 1) {
    const offset = generatedRange.previousFirst - back;
    generateDay(offset, false, MONTHLY_CAP[Math.floor(back / 30) % MONTHLY_CAP.length] ?? 5);
}

bookings.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

const usedRefs = new Set<string>();
function uniqueRef(startsAt: Date): string {
    let ref = buildRef(startsAt, CLINIC_OFFSET_MINUTES);
    while (usedRefs.has(ref)) ref = buildRef(startsAt, CLINIC_OFFSET_MINUTES);
    usedRefs.add(ref);
    return ref;
}

function branchOpenOn(startsAt: Date): { id: string } | undefined {
    const weekday = new Date(startsAt.getTime() + CLINIC_OFFSET_MINUTES * 60_000).getUTCDay();
    const day = days.find((d) => d.weekday === weekday);
    return day?.branchId === secondBranch.id ? secondBranch : day ? mainBranch : undefined;
}

const appointmentRows: (typeof appointments.$inferInsert)[] = [];
const planRows: (typeof appointmentProcedures.$inferInsert)[] = [];
const visitRows: (typeof visits.$inferInsert)[] = [];
const lineRows: (typeof visitProcedures.$inferInsert)[] = [];
const paymentRows: (typeof payments.$inferInsert)[] = [];
const reminderRows: (typeof reminders.$inferInsert)[] = [];

for (const booking of bookings) {
    // The live ones are reached, not written — `seedService` walks them through
    // check-in after this transaction lands. They stayed in `bookings` so the
    // generator would route its column around their slots, and that is all they
    // were needed for.
    if (booking.live) continue;

    const appointmentId = id();
    const durationMinutes = booking.durationMinutes ?? DEFAULT_DURATION_MINUTES;

    appointmentRows.push({
        id: appointmentId,
        ref: uniqueRef(booking.startsAt),
        patientId: booking.patient.id,
        branchId: branchOpenOn(booking.startsAt)?.id ?? booking.branch.id,
        startsAt: booking.startsAt,
        durationMinutes,
        note: booking.note ?? null,
        status: booking.status,
        channel: booking.channel ?? 'desk',
        createdAt: new Date(booking.startsAt.getTime() - 3 * 86_400_000),
        updatedAt: booking.startsAt,
    });

    const plan =
        booking.plan ??
        (booking.type
            ? [
                  {
                      procedure: booking.type,
                      tooth: booking.type.isToothSpecific
                          ? (booking.visit?.lines.find((l) => l.procedure.id === booking.type?.id)?.tooth ??
                            ('UR6' as Tooth))
                          : undefined,
                  },
              ]
            : []);

    plan.forEach((line, i) => {
        planRows.push({
            id: id(),
            appointmentId,
            procedureId: line.procedure.id,
            quantity: line.quantity ?? 1,
            tooth: line.tooth ?? null,
            note: line.note ?? null,
            sortOrder: i,
        });
    });

    if (booking.visit) {
        const visitId = id();
        const computedTotal = booking.visit.lines.reduce(
            (sum, line) => sum + (line.unitPrice ?? line.procedure.defaultPrice) * (line.quantity ?? 1),
            0,
        );

        visitRows.push({
            id: visitId,
            appointmentId,
            checkedInAt: booking.visit.checkedInAt,
            inChairAt:
                booking.visit.inChairAt === undefined ? booking.visit.checkedInAt : booking.visit.inChairAt,
            pricedAt: booking.visit.lines.length > 0 ? booking.visit.checkedInAt : null,
            completedAt: booking.visit.completedAt ?? null,
            computedTotal,
            chargedTotal: booking.visit.chargedTotal ?? computedTotal,
            createdAt: booking.visit.checkedInAt,
        });

        for (const line of booking.visit.lines) {
            lineRows.push({
                id: id(),
                visitId,
                procedureId: line.procedure.id,
                quantity: line.quantity ?? 1,
                unitPrice: line.unitPrice ?? line.procedure.defaultPrice,
                unitCost: line.procedure.cost,
                tooth: line.tooth ?? null,
                note: line.note ?? null,
            });
        }

        for (const payment of booking.visit.payments ?? []) {
            paymentRows.push({
                id: id(),
                visitId,
                amount: payment.amount,
                method: payment.method,
                methodNote: payment.methodNote ?? null,
                paidAt: payment.paidAt,
            });
        }
    }

    if (booking.reminder) {
        reminderRows.push({
            id: id(),
            appointmentId,
            dueAt: new Date(booking.startsAt.getTime() - DEFAULT_REMINDER_LEAD_HOURS * 3_600_000),
            status: booking.reminder.status,
            sentAt: booking.reminder.sentAt ?? null,
        });
    }
}

await db.transaction(async (tx) => {
    await tx.delete(payments);
    await tx.delete(visitProcedures);
    await tx.delete(visits);
    await tx.delete(reminders);
    await tx.delete(appointmentProcedures);
    await tx.delete(appointments);
    await tx.delete(clinicDays);
    await tx.delete(patients);
    await tx.delete(procedureTypes);
    await tx.delete(customQuestions);
    await tx.delete(branches);

    await tx.insert(branches).values([mainBranch, secondBranch, oldBranch]);
    await tx.insert(clinicDays).values(days);
    await tx.insert(procedureTypes).values(procedures);
    await tx.insert(customQuestions).values(questions);
    await tx.insert(patients).values(allPatients);
    await tx.insert(appointments).values(appointmentRows);
    if (planRows.length > 0) await tx.insert(appointmentProcedures).values(planRows);
    await tx.insert(visits).values(visitRows);
    if (lineRows.length > 0) await tx.insert(visitProcedures).values(lineRows);
    if (paymentRows.length > 0) await tx.insert(payments).values(paymentRows);
    await tx.insert(reminders).values(reminderRows);

    await tx
        .insert(settings)
        .values({
            id: 1,
            clinicName: 'Lustre Clinic',
            clinicPhone: '+20223456789',
            reminderTemplate: DEFAULT_REMINDER_TEMPLATE,
            patientRefNext: lastPatientRef + 1,
        })
        .onConflictDoUpdate({
            target: settings.id,
            set: {
                clinicName: 'Lustre Clinic',
                clinicPhone: '+20223456789',
                patientRefNext: lastPatientRef + 1,
                updatedAt: new Date(),
            },
        });
});

/**
 * Today's queue, after the rest of the day is in place.
 *
 * Written last on purpose. `seedService` calls `appointment.create`, which
 * checks the exclusion constraint against the day as it stands, so the column
 * these four have to fit into must already exist. Arrival order is the array's
 * order — longest wait first — because that is what the promotion inside
 * `awaitPayment` reads when the chair empties.
 */
const liveBookings = bookings
    .filter((booking) => booking.live !== undefined)
    .sort((a, b) => (b.live?.arrivedAgo ?? 0) - (a.live?.arrivedAgo ?? 0));

const live = await seedService.liveDay(
    liveBookings.map((booking) => ({
        patientId: booking.patient.id,
        branchId: branchOpenOn(booking.startsAt)?.id ?? booking.branch.id,
        startsAt: booking.startsAt,
        durationMinutes: booking.durationMinutes ?? DEFAULT_DURATION_MINUTES,
        procedures: (booking.plan ?? (booking.type ? [{ procedure: booking.type }] : [])).map((line) => ({
            procedureId: line.procedure.id,
            quantity: 'quantity' in line ? line.quantity : undefined,
            tooth:
                'tooth' in line && line.tooth
                    ? line.tooth
                    : line.procedure.isToothSpecific
                      ? ('UR6' as Tooth)
                      : undefined,
            note: 'note' in line ? line.note : undefined,
        })),
        arrivedAgo: booking.live?.arrivedAgo ?? 0,
        seatedAgo: booking.live?.seatedAgo,
        reach: booking.live?.reach ?? 'waiting',
        channel: booking.channel === 'walk_in' ? ('walk_in' as const) : ('desk' as const),
        note: booking.note,
    })),
);

// Which day the fixtures actually landed on, and where. Everything here is
// relative to the moment the seed runs, so a database seeded yesterday has an
// empty today — and because a booking's branch is whichever one is open that
// weekday (`branchOpenOn`), today's work moves between Nasr City and Maadi as
// the week turns. Both of those read as "the app is broken" from the day view,
// so the seed says out loud what it just made.
const todayStart = todayLocalMidnight.getTime();
// `live` is counted separately: those rows were created by the services after
// this array was built, so they are not in it.
const todayRows = appointmentRows.filter((row) => {
    const startsAt = (row.startsAt as Date).getTime();
    return startsAt >= todayStart && startsAt < todayStart + 86_400_000;
});
const openTodayId = branchOpenOn(at(0, '12:00'))?.id;
const openToday =
    openTodayId === undefined
        ? 'closed today'
        : openTodayId === secondBranch.id
          ? secondBranch.name
          : mainBranch.name;

logger.info(
    {
        branches: 3,
        patients: allPatients.length,
        appointments: appointmentRows.length + live.length,
        live: live.length,
        visits: visitRows.length,
        payments: paymentRows.length,
        reminders: reminderRows.length,
        // Shifted back into clinic-local before formatting: local midnight is
        // 21:00 UTC the day before, so a bare toISOString names the wrong day.
        today: new Date(todayStart + CLINIC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10),
        todayBranch: openToday,
        todayAppointments: todayRows.length + live.length,
    },
    'seeded',
);

if (todayRows.length === 0) {
    logger.warn(
        'nothing is booked today — the clinic is closed on this weekday, so the day view will be empty until you move to an open one',
    );
}

await sql.end();
