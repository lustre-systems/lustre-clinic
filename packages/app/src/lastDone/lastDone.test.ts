/**
 * What a write reads as in "Last done", and how long it stays: the last 30 or
 * the last seven days, whichever is fewer, and only a write that answered.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const stored = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
        setItem: (key: string, value: string) => Promise.resolve(void stored.set(key, value)),
        removeItem: (key: string) => Promise.resolve(void stored.delete(key)),
    },
}));

const { describeWrite, targetOf } = await import('./entry');
const { forgetFacts, noteAnswer, knownAppointment, patientName, appointmentOfVisit } = await import(
    './facts'
);
const { createLastDoneStore, hasUnseen, MAX_AGE_MS, MAX_ENTRIES, prune } = await import('./store');

import type { LastDoneEntry } from './entry';

const DAY = 24 * 60 * 60_000;

function entry(id: string, at: number): LastDoneEntry {
    return {
        id,
        kind: 'book',
        at,
        patientId: 'p1',
        patientName: 'Ahmed Ali',
        appointmentId: 'a1',
        visitId: null,
        detail: null,
    };
}

describe('describeWrite', () => {
    it('books for someone on file, with the slot', () => {
        const draft = describeWrite(
            'appointment.create',
            { patient: { kind: 'existing', patientId: 'p1' }, startsAt: '2026-10-14T13:00:00.000Z' },
            { id: 'a1', patientId: 'p1', startsAt: '2026-10-14T13:00:00.000Z' },
        );
        expect(draft).toMatchObject({
            kind: 'book',
            patientId: 'p1',
            appointmentId: 'a1',
            detail: { type: 'slot', startsAt: '2026-10-14T13:00:00.000Z' },
        });
    });

    it('takes a new patient’s name from what was sent', () => {
        const draft = describeWrite(
            'appointment.create',
            { patient: { kind: 'new', name: 'Mona Hassan', phone: '0100' } },
            { id: 'a2', patientId: 'p2', startsAt: '2026-10-14T13:00:00.000Z' },
        );
        expect(draft).toMatchObject({ patientId: 'p2', patientName: 'Mona Hassan' });
    });

    it('reads a move from the time the phone held before it', () => {
        const draft = describeWrite(
            'appointment.update',
            { id: 'a1', startsAt: '2026-10-11T10:00:00.000Z' },
            { id: 'a1', patientId: 'p1', startsAt: '2026-10-11T10:00:00.000Z' },
            { startsAt: '2026-10-09T10:00:00.000Z' },
        );
        expect(draft).toMatchObject({
            kind: 'move',
            detail: { type: 'move', from: '2026-10-09T10:00:00.000Z', to: '2026-10-11T10:00:00.000Z' },
        });
    });

    it('logs a no-show, and not a lab flag', () => {
        const out = { id: 'a1', patientId: 'p1', startsAt: '2026-10-11T10:00:00.000Z' };
        expect(describeWrite('appointment.update', { id: 'a1', status: 'no_show' }, out)?.kind).toBe(
            'noShow',
        );
        expect(describeWrite('appointment.update', { id: 'a1', needsLab: true }, out)).toBeNull();
    });

    it('names the first procedure and counts the rest', () => {
        const draft = describeWrite(
            'visit.setProcedures',
            { visitId: 'v1' },
            {
                id: 'v1',
                appointmentId: 'a1',
                procedures: [
                    { name: 'Filling', tooth: '14' },
                    { name: 'Scaling', tooth: null },
                ],
            },
        );
        expect(draft).toMatchObject({
            kind: 'procedures',
            visitId: 'v1',
            appointmentId: 'a1',
            detail: { type: 'procedure', name: 'Filling', tooth: '14', more: 1 },
        });
    });

    it('records a payment by what was paid', () => {
        const draft = describeWrite(
            'balance.settle',
            { patientId: 'p1', amount: 50_000, method: 'cash' },
            { patientId: 'p1', amount: 50_000 },
        );
        expect(draft).toMatchObject({ kind: 'payment', detail: { type: 'amount', amount: 50_000 } });
    });

    it('ignores what it was not asked to list', () => {
        expect(describeWrite('reminder.markSent', { id: 'r1' }, {})).toBeNull();
        expect(describeWrite('settings.update', {}, {})).toBeNull();
    });
});

describe('targetOf', () => {
    it('leaves a cancellation with nothing to open', () => {
        expect(targetOf({ ...entry('1', 0), kind: 'cancel' })).toBeNull();
    });

    it('opens a booking, a visit, or falls back to the record', () => {
        expect(targetOf(entry('1', 0))).toEqual({ kind: 'booking', appointmentId: 'a1' });
        expect(targetOf({ ...entry('1', 0), kind: 'checkIn', visitId: 'v1' })).toEqual({
            kind: 'visit',
            appointmentId: 'a1',
            visitId: 'v1',
        });
        expect(targetOf({ ...entry('1', 0), kind: 'finish' })).toEqual({ kind: 'patient', patientId: 'p1' });
    });
});

describe('facts', () => {
    beforeEach(forgetFacts);

    it('learns names and ids from a day’s answer', () => {
        noteAnswer([
            [
                {
                    id: 'a1',
                    patientId: 'p1',
                    startsAt: '2026-10-11T10:00:00.000Z',
                    patient: { id: 'p1', name: 'Ahmed Ali', phone: '0100' },
                },
            ],
        ]);
        noteAnswer({ id: 'v1', appointmentId: 'a1', checkedInAt: '2026-10-11T10:05:00.000Z' });

        expect(knownAppointment('a1')?.patientId).toBe('p1');
        expect(patientName('p1')).toBe('Ahmed Ali');
        expect(appointmentOfVisit('v1')).toBe('a1');
    });

    it('does not take a branch for a patient', () => {
        noteAnswer({ id: 'b1', name: 'Downtown', address: null });
        expect(patientName('b1')).toBeNull();
    });
});

describe('store', () => {
    beforeEach(() => stored.clear());

    it('keeps the newest thirty', () => {
        const now = 10 * DAY;
        const many = Array.from({ length: 40 }, (_, i) => entry(String(i), now - i * 1000));
        const kept = prune(many, now);
        expect(kept).toHaveLength(MAX_ENTRIES);
        expect(kept[0]?.id).toBe('0');
    });

    it('drops anything older than seven days', () => {
        const now = 10 * DAY;
        const kept = prune([entry('new', now - DAY), entry('old', now - MAX_AGE_MS - 1)], now);
        expect(kept.map((e) => e.id)).toEqual(['new']);
    });

    it('does not overwrite the stored log with a write made before it was read', async () => {
        const now = 10 * DAY;
        stored.set('t', JSON.stringify({ entries: [entry('stored', now - 1000)], seenAt: 0 }));
        const store = createLastDoneStore('t', () => now);

        await store.add(entry('fresh', now));

        expect(store.getSnapshot().entries.map((e) => e.id)).toEqual(['fresh', 'stored']);
        expect(JSON.parse(stored.get('t') ?? '{}').entries).toHaveLength(2);
    });

    it('stops calling for attention once the sheet has been opened', async () => {
        let now = 10 * DAY;
        const store = createLastDoneStore('t', () => now);
        await store.add(entry('1', now));
        expect(hasUnseen(store.getSnapshot())).toBe(true);

        now += 1000;
        store.markSeen();
        expect(hasUnseen(store.getSnapshot())).toBe(false);
    });

    it('forgets everything on clear', async () => {
        const store = createLastDoneStore('t', () => 10 * DAY);
        await store.add(entry('1', 10 * DAY));
        store.clear();
        expect(store.getSnapshot().entries).toHaveLength(0);
        expect(stored.has('t')).toBe(false);
    });
});

describe('the sheet’s words', async () => {
    const { subline, whenText } = await import('./format');

    it('reads the time relative inside the hour', () => {
        expect(whenText(0, 30_000, 'en')).toBe('Just now');
        expect(whenText(0, 2 * 60_000, 'en')).toBe('2m');
    });

    it('joins the name and the detail, and hides money from a phone that may not see it', () => {
        const paid: LastDoneEntry = {
            ...entry('1', 0),
            kind: 'payment',
            detail: { type: 'amount', amount: 50_000 },
        };
        expect(subline(paid, 'en', true)).toBe('Ahmed Ali · EGP 500');
        expect(subline(paid, 'en', false)).toBe('Ahmed Ali');
        const procedure: LastDoneEntry = {
            ...entry('2', 0),
            kind: 'procedures',
            detail: { type: 'procedure', name: 'Filling', tooth: '14', more: 1 },
        };
        expect(subline(procedure, 'en', true)).toBe('Ahmed Ali · Filling — 14 +1');
    });
});

describe('the demo’s opening log', async () => {
    const { demoEntries } = await import('./demo');
    const { seedDemoDb } = await import('../api/demo/seed');

    it('names demo patients, newest first, and fills only an empty log', async () => {
        const now = Date.now();
        const entries = demoEntries(seedDemoDb(), now);
        expect(entries.length).toBeGreaterThan(2);
        expect(entries.every((e) => e.patientName !== null && e.at < now)).toBe(true);

        stored.clear();
        const store = createLastDoneStore('demo-t', () => now);
        await store.seedIfEmpty(entries);
        expect(hasUnseen(store.getSnapshot())).toBe(true);

        await store.seedIfEmpty([entry('other', now)]);
        expect(store.getSnapshot().entries).toHaveLength(entries.length);
    });
});

describe('the button’s label', async () => {
    const { buttonLabel } = await import('./format');

    it('is a short word and the first name', () => {
        expect(buttonLabel({ ...entry('1', 0), kind: 'checkIn', patientName: 'Yara Fouad' }, 'en')).toBe(
            'Checked in · Yara',
        );
        expect(buttonLabel({ ...entry('2', 0), kind: 'payment', patientName: null }, 'en')).toBe('Payment');
    });
});
