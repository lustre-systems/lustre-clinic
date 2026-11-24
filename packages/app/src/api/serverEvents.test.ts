import { describe, expect, it } from 'bun:test';
import { WS_EVENT, WS_PROTOCOL_VERSION, type WsEvent } from '@lustre/shared';
import { type Area, createEventCursor, createRefreshBatch } from './serverEvents';

const hello = (epoch: string, seq: number, resync = false) => ({
    v: WS_PROTOCOL_VERSION,
    type: 'hello',
    epoch,
    seq,
    resync,
});

const event = (epoch: string, seq: number, name: WsEvent = WS_EVENT.VISIT_UPDATED, id = 'v1') => ({
    v: WS_PROTOCOL_VERSION,
    type: 'event',
    epoch,
    seq,
    at: 1_000,
    event: name,
    id,
});

function connected(epoch = 'e1', seq = 0) {
    const cursor = createEventCursor();
    cursor.read(hello(epoch, seq, true));
    return cursor;
}

describe('the event cursor', () => {
    it('refetches everything on the first hello, which cannot know what happened before it', () => {
        const cursor = createEventCursor();
        expect(cursor.resumeQuery()).toBe('');
        expect(cursor.read(hello('e1', 7))).toMatchObject({ outcome: 'resync', resync: true });
        expect(cursor.resumeQuery()).toBe('?epoch=e1&since=7');
    });

    it('applies events in order and remembers the last one for the next connect', () => {
        const cursor = connected();
        expect(cursor.read(event('e1', 1))).toMatchObject({ outcome: 'applied', resync: false });
        expect(cursor.read(event('e1', 2, WS_EVENT.VISIT_COMPLETED, 'a1')).event).toMatchObject({
            event: WS_EVENT.VISIT_COMPLETED,
            id: 'a1',
            seq: 2,
        });
        expect(cursor.resumeQuery()).toBe('?epoch=e1&since=2');
    });

    it('drops an event it has already applied, so a replay cannot notify twice', () => {
        const cursor = connected();
        cursor.read(event('e1', 1));
        cursor.read(event('e1', 2));
        expect(cursor.read(event('e1', 2))).toEqual({ outcome: 'duplicate', resync: false, event: null });
        expect(cursor.read(event('e1', 1))).toEqual({ outcome: 'duplicate', resync: false, event: null });
    });

    it('resumes quietly when the server replayed everything that was missed', () => {
        const cursor = connected('e1', 3);
        expect(cursor.read(event('e1', 4)).outcome).toBe('applied');
        expect(cursor.read(event('e1', 5)).outcome).toBe('applied');
        expect(cursor.read(hello('e1', 5))).toEqual({ outcome: 'ignored', resync: false, event: null });
    });

    it('refetches everything when the server says the gap could not be replayed', () => {
        const cursor = connected('e1', 3);
        expect(cursor.read(hello('e1', 400, true))).toMatchObject({ resync: true });
        expect(cursor.read(event('e1', 401)).outcome).toBe('applied');
    });

    it('refetches everything across a hole in the sequence, and still applies the event', () => {
        const cursor = connected();
        cursor.read(event('e1', 1));
        const step = cursor.read(event('e1', 3, WS_EVENT.VISIT_COMPLETED, 'a9'));
        expect(step.resync).toBe(true);
        expect(step.event?.id).toBe('a9');
    });

    it('treats a restarted server as a gap, whatever its numbers say', () => {
        const cursor = connected('e1', 10);
        expect(cursor.read(hello('e2', 10))).toMatchObject({ resync: true });
        expect(cursor.read(event('e2', 11)).outcome).toBe('applied');
    });

    it('refetches everything for a protocol it does not know, and stops resuming', () => {
        const cursor = connected('e1', 3);
        expect(cursor.read({ ...event('e1', 4), v: WS_PROTOCOL_VERSION + 1 })).toEqual({
            outcome: 'resync',
            resync: true,
            event: null,
        });
        expect(cursor.resumeQuery()).toBe('');
    });

    it('refetches everything for an event name this build does not know', () => {
        const cursor = connected();
        expect(cursor.read({ ...event('e1', 1), event: 'invoice:sent' })).toEqual({
            outcome: 'resync',
            resync: true,
            event: null,
        });
        expect(cursor.read(event('e1', 2)).outcome).toBe('applied');
    });

    it('ignores what is not a frame', () => {
        const cursor = connected();
        for (const junk of [
            null,
            'visit:updated',
            3,
            { v: WS_PROTOCOL_VERSION },
            { ...event('e1', 1), seq: 1.5 },
        ]) {
            expect(cursor.read(junk).outcome).toBe('ignored');
        }
        expect(cursor.read(event('e1', 1)).outcome).toBe('applied');
    });
});

describe('the refresh batch', () => {
    function batch() {
        const runs: (ReadonlySet<Area> | 'all')[] = [];
        const deferred: (() => void)[] = [];
        const push = createRefreshBatch(
            (areas) => runs.push(areas),
            (flush) => deferred.push(flush),
        );
        const flush = () => {
            for (const next of deferred.splice(0)) next();
        };
        return { push, runs, flush };
    }

    it('folds a burst into one refetch per router', () => {
        const { push, runs, flush } = batch();
        push(WS_EVENT.VISIT_UPDATED);
        push(WS_EVENT.APPOINTMENT_UPDATED);
        push(WS_EVENT.VISIT_UPDATED);
        expect(runs).toEqual([]);
        flush();
        expect(runs).toHaveLength(1);
        expect([...(runs[0] as ReadonlySet<Area>)].sort()).toEqual([
            'appointment',
            'balance',
            'patient',
            'reminder',
            'stats',
            'visit',
        ]);
    });

    it('lets a resync swallow everything else in the burst', () => {
        const { push, runs, flush } = batch();
        push(WS_EVENT.SETTINGS_UPDATED);
        push('all');
        push(WS_EVENT.VISIT_UPDATED);
        flush();
        expect(runs).toEqual(['all']);
    });

    it('starts a new batch after a flush', () => {
        const { push, runs, flush } = batch();
        push(WS_EVENT.REMINDER_UPDATED);
        flush();
        push(WS_EVENT.CATALOG_UPDATED);
        flush();
        expect(runs.map((areas) => (areas === 'all' ? 'all' : [...areas]))).toEqual([
            ['reminder'],
            ['branch', 'procedure', 'customQuestion'],
        ]);
    });
});
