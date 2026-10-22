/**
 * The one place a write is logged: a tRPC link at the head of the client's
 * chain, ahead of the split between the clinic server and the phone's own
 * database. Every write in the app crosses it, whichever screen or data layer
 * sent it — the day cluster's raw calls, the patients cluster's mutations,
 * `usePendingAction` presses — so a new write path is logged without anyone
 * remembering to log it. Only an answer is logged; a refusal or a request that
 * never landed passes through untouched and leaves no line behind.
 *
 * Answers to reads go past it too, and feed `facts`, which is how a check-in
 * that answers with two ids becomes a line with the patient's name on it. When
 * nothing read so far names them, `lookup` asks for the appointment or the
 * patient once, and the line is written without the name if that fails too:
 * the write happened.
 *
 * Nothing here is logged, reported or thrown. It runs inside every request, and
 * what it handles is patient data.
 */
import type { AppRouter } from '@lustre/server/src/trpc/router.ts';
import type { TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { dataGeneration, subscribeToDataReset } from '../api/dataReset';
import { getDb } from '../api/demo/db';
import { deviceBackend } from '../api/demo/flag';
import { openDeviceDb } from '../api/demo/link';
import { demoEntries } from './demo';
import { type BeforeWrite, describeWrite, type LastDoneDraft } from './entry';
import {
    appointmentOfVisit,
    forgetFacts,
    knownAppointment,
    noteAnswer,
    patientName,
    visitOfAppointment,
} from './facts';
import { lastDone } from './store';

export interface Lookup {
    appointment: (id: string) => Promise<unknown>;
    patient: (id: string) => Promise<unknown>;
}

// The patients it names are not the ones on the phone any more.
subscribeToDataReset(() => {
    forgetFacts();
    lastDone.clear();
});

let seededFor = -1;

/**
 * A demo opens with a few lines already in the log (`demo.ts`), so the button
 * has something to show. Asked on the first request of each data generation —
 * entering the demo, reseeding it, or launching into it.
 */
function seedDemo(): void {
    if (deviceBackend() !== 'demo' || seededFor === dataGeneration()) return;
    seededFor = dataGeneration();
    void openDeviceDb('demo')
        .then(() => lastDone.seedIfEmpty(demoEntries(getDb(), Date.now())))
        .catch(() => undefined);
}

let sequence = 0;

function entryId(at: number): string {
    sequence += 1;
    return `${at.toString(36)}-${sequence.toString(36)}`;
}

function beforeWrite(path: string, input: unknown): BeforeWrite {
    if (path !== 'appointment.update' && path !== 'appointment.cancel') return { startsAt: null };
    const id = typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined;
    return { startsAt: typeof id === 'string' ? (knownAppointment(id)?.startsAt ?? null) : null };
}

async function quietly(read: () => Promise<unknown>): Promise<void> {
    await read().catch(() => undefined);
}

/** Fills in the ids and the name the answer left out, from `facts` first and the server second. */
async function complete(draft: LastDoneDraft, lookup: Lookup): Promise<LastDoneDraft> {
    let { appointmentId, visitId, patientId, patientName: name } = draft;

    if (appointmentId === null && visitId !== null) appointmentId = appointmentOfVisit(visitId);
    if (visitId === null && appointmentId !== null && draft.kind === 'finish') {
        visitId = visitOfAppointment(appointmentId);
    }

    if (patientId === null && appointmentId !== null) {
        if (!knownAppointment(appointmentId))
            await quietly(() => lookup.appointment(appointmentId as string));
        patientId = knownAppointment(appointmentId)?.patientId ?? null;
    }

    if (name === null && patientId !== null) {
        if (patientName(patientId) === null) await quietly(() => lookup.patient(patientId as string));
        name = patientName(patientId);
    }

    return { ...draft, appointmentId, visitId, patientId, patientName: name };
}

async function record(draft: LastDoneDraft, at: number, lookup: Lookup): Promise<void> {
    const done = await complete(draft, lookup);
    await lastDone.add({ ...done, id: entryId(at), at });
}

export function lastDoneLink(lookup: Lookup): TRPCLink<AppRouter> {
    return () =>
        ({ op, next }) =>
            observable((observer) => {
                seedDemo();
                const before = op.type === 'mutation' ? beforeWrite(op.path, op.input) : null;

                const subscription = next(op).subscribe({
                    next(envelope) {
                        try {
                            const result = envelope.result;
                            const data = 'data' in result ? result.data : undefined;
                            noteAnswer(data);
                            if (before) {
                                const draft = describeWrite(op.path, op.input, data, before);
                                if (draft) void record(draft, Date.now(), lookup).catch(() => undefined);
                            }
                        } catch {
                            // The log never stands in a write's way.
                        }
                        observer.next(envelope);
                    },
                    error(error) {
                        observer.error(error);
                    },
                    complete() {
                        observer.complete();
                    },
                });

                return () => subscription.unsubscribe();
            });
}
