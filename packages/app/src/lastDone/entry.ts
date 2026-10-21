/**
 * What one write on this phone reads as in the "Last done" sheet, worked out
 * from the procedure's path, what was sent and what came back.
 *
 * Only the writes the dentist asked about are listed: book, move, cancel,
 * no-show, check in, finish, procedures, payments, a patient added or edited,
 * and an old visit. Anything else answers `null` and is not logged — a lab
 * flag or a reminder ticked off is not something anyone forgets doing.
 *
 * The detail is kept as data, not as a sentence, so the sheet says it in the
 * language that is on when it is opened rather than the one that was on when
 * the write happened.
 */

export const LAST_DONE_KINDS = [
    'book',
    'move',
    'cancel',
    'noShow',
    'checkIn',
    'finish',
    'procedures',
    'payment',
    'paymentFix',
    'addPatient',
    'editPatient',
    'oldVisit',
] as const;

export type LastDoneKind = (typeof LAST_DONE_KINDS)[number];

export type LastDoneDetail =
    | { type: 'slot'; startsAt: string }
    | { type: 'move'; from: string | null; to: string }
    | { type: 'amount'; amount: number }
    | { type: 'procedure'; name: string; tooth: string | null; more: number }
    | { type: 'day'; date: string }
    | { type: 'phone'; phone: string }
    | { type: 'walkIn' };

export interface LastDoneEntry {
    id: string;
    kind: LastDoneKind;
    /** Phone time, ms. */
    at: number;
    patientId: string | null;
    patientName: string | null;
    appointmentId: string | null;
    visitId: string | null;
    detail: LastDoneDetail | null;
}

/** What a write says about itself, before the name behind its ids is looked up. */
export type LastDoneDraft = Omit<LastDoneEntry, 'id' | 'at'>;

/** What the phone knew just before the write went out — a move's old time. */
export interface BeforeWrite {
    startsAt: string | null;
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
    return typeof value === 'object' && value !== null ? (value as Fields) : {};
}

function str(record: Fields, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function int(record: Fields, key: string): number | null {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function draft(kind: LastDoneKind, parts: Partial<LastDoneDraft> = {}): LastDoneDraft {
    return {
        kind,
        patientId: null,
        patientName: null,
        appointmentId: null,
        visitId: null,
        detail: null,
        ...parts,
    };
}

/** The patient a booking named: one on file, or one registered with it. */
function bookedFor(input: Fields): Pick<LastDoneDraft, 'patientId' | 'patientName'> {
    const patient = fields(input.patient);
    return patient.kind === 'new'
        ? { patientId: null, patientName: str(patient, 'name') }
        : { patientId: str(patient, 'patientId'), patientName: null };
}

function paid(amount: number | null): LastDoneDetail | null {
    return amount !== null && amount > 0 ? { type: 'amount', amount } : null;
}

function firstProcedure(visit: Fields): LastDoneDetail | null {
    const lines = Array.isArray(visit.procedures) ? visit.procedures.map(fields) : [];
    const first = lines[0];
    const name = first ? str(first, 'name') : null;
    if (!first || name === null) return null;
    return { type: 'procedure', name, tooth: str(first, 'tooth'), more: lines.length - 1 };
}

/** The visit a visit-shaped answer is, with the appointment it hangs off. */
function onVisit(kind: LastDoneKind, visit: Fields, detail: LastDoneDetail | null): LastDoneDraft {
    return draft(kind, {
        visitId: str(visit, 'id'),
        appointmentId: str(visit, 'appointmentId'),
        detail,
    });
}

export function describeWrite(
    path: string,
    rawInput: unknown,
    rawOutput: unknown,
    before: BeforeWrite = { startsAt: null },
): LastDoneDraft | null {
    const input = fields(rawInput);
    const output = fields(rawOutput);

    switch (path) {
        case 'appointment.create': {
            const startsAt = str(output, 'startsAt') ?? str(input, 'startsAt');
            return draft('book', {
                ...bookedFor(input),
                patientId: str(output, 'patientId') ?? bookedFor(input).patientId,
                appointmentId: str(output, 'id'),
                detail: startsAt ? { type: 'slot', startsAt } : null,
            });
        }

        case 'appointment.walkIn': {
            const appointment = fields(output.appointment);
            return draft('checkIn', {
                ...bookedFor(input),
                patientId: str(appointment, 'patientId') ?? bookedFor(input).patientId,
                appointmentId: str(appointment, 'id'),
                visitId: str(output, 'visitId'),
                detail: { type: 'walkIn' },
            });
        }

        case 'appointment.update': {
            const base = {
                appointmentId: str(output, 'id') ?? str(input, 'id'),
                patientId: str(output, 'patientId'),
            };
            if (input.status === 'no_show') return draft('noShow', base);
            const to = str(output, 'startsAt');
            const moved = str(input, 'startsAt') !== null || str(input, 'branchId') !== null;
            if (!moved || to === null) return null;
            return draft('move', { ...base, detail: { type: 'move', from: before.startsAt, to } });
        }

        case 'appointment.cancel': {
            const startsAt = str(output, 'startsAt') ?? before.startsAt;
            return draft('cancel', {
                appointmentId: str(output, 'id') ?? str(input, 'id'),
                patientId: str(output, 'patientId'),
                detail: startsAt ? { type: 'slot', startsAt } : null,
            });
        }

        // The doctor's "finished": the patient goes to the desk to pay.
        case 'appointment.awaitPayment':
            return draft('finish', {
                appointmentId: str(output, 'id') ?? str(input, 'id'),
                patientId: str(output, 'patientId'),
            });

        case 'visit.checkIn':
            return draft('checkIn', {
                visitId: str(output, 'id'),
                appointmentId: str(output, 'appointmentId') ?? str(input, 'appointmentId'),
            });

        case 'visit.checkOut':
            return onVisit('finish', output, paid(int(input, 'paidTotal')));

        case 'visit.setProcedures':
            return onVisit('procedures', output, firstProcedure(output));

        case 'visit.recordPayment':
            return onVisit('payment', output, paid(int(input, 'amount')));

        case 'visit.setPaid': {
            const total = int(input, 'paidTotal');
            return onVisit('paymentFix', output, total === null ? null : { type: 'amount', amount: total });
        }

        case 'balance.settle':
            return draft('payment', {
                patientId: str(output, 'patientId') ?? str(input, 'patientId'),
                detail: paid(int(output, 'amount') ?? int(input, 'amount')),
            });

        case 'patient.create': {
            const phone = str(output, 'phone') ?? str(input, 'phone');
            return draft('addPatient', {
                patientId: str(output, 'id'),
                patientName: str(output, 'name') ?? str(input, 'name'),
                detail: phone ? { type: 'phone', phone } : null,
            });
        }

        case 'patient.update':
        case 'patient.updateRef':
            return draft('editPatient', {
                patientId: str(output, 'id') ?? str(input, 'id'),
                patientName: str(output, 'name'),
            });

        case 'procedure.addOldVisit': {
            const date = str(input, 'performedOn');
            return draft('oldVisit', {
                patientId: str(input, 'patientId'),
                appointmentId: str(output, 'appointmentId'),
                visitId: str(output, 'visitId'),
                detail: date ? { type: 'day', date } : null,
            });
        }

        default:
            return null;
    }
}

/** Where a line goes when it is tapped. A cancellation has nothing left to open. */
export type LastDoneTarget =
    | { kind: 'patient'; patientId: string }
    | { kind: 'visit'; appointmentId: string; visitId: string }
    | { kind: 'booking'; appointmentId: string };

export function targetOf(entry: LastDoneEntry): LastDoneTarget | null {
    const patient: LastDoneTarget | null = entry.patientId
        ? { kind: 'patient', patientId: entry.patientId }
        : null;

    switch (entry.kind) {
        case 'cancel':
            return null;
        case 'book':
        case 'move':
            return entry.appointmentId ? { kind: 'booking', appointmentId: entry.appointmentId } : patient;
        case 'checkIn':
        case 'finish':
        case 'procedures':
        case 'payment':
        case 'paymentFix':
        case 'oldVisit':
            return entry.appointmentId && entry.visitId
                ? { kind: 'visit', appointmentId: entry.appointmentId, visitId: entry.visitId }
                : patient;
        case 'noShow':
        case 'addPatient':
        case 'editPatient':
            return patient;
    }
}
