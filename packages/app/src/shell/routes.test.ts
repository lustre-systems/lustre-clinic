// The shell's navigation rules, which is all of them that can be checked
// without a renderer: an ask has to be distinguishable from the one before it,
// a home signal has to reach one tab without disturbing the other three, and
// the disconnected route has to go up on a drop without flickering on a probe.
import { describe, expect, it } from 'bun:test';
import { ALL_TABS, ask, bumpHome, isUnseen, NO_HOME, nextRoute } from './routes';

describe('a cross-cluster ask (SPEC §18 F3 — no navigator yet)', () => {
    it('starts at 1, so an untouched cluster reading 0 sees the first one', () => {
        expect(ask(undefined, { patientId: 'p1' })).toEqual({ patientId: 'p1', seq: 1 });
        expect(isUnseen(ask(undefined, { patientId: 'p1' }), 0)).toBe(true);
    });

    it('counts up, so the same patient asked for twice is two asks', () => {
        const first = ask(undefined, { patientId: 'p1' });
        const second = ask(first, { patientId: 'p1' });

        expect(second.seq).toBe(2);
        // What makes backing out of a record and tapping the same row again work.
        expect(isUnseen(second, first.seq)).toBe(true);
    });

    it('is seen once the cluster has acted on it', () => {
        const request = ask(undefined, { patientId: 'p1' });
        expect(isUnseen(request, request.seq)).toBe(false);
    });

    it('is nothing to act on when there has been no ask at all', () => {
        expect(isUnseen(undefined, 0)).toBe(false);
    });

    it('carries the destination through untouched', () => {
        expect(ask(undefined, { patient: { id: 'p1' }, timing: 'now' })).toEqual({
            patient: { id: 'p1' },
            timing: 'now',
            seq: 1,
        });
    });
});

describe('going home (tapping the tab you are already on)', () => {
    it('moves the tab that was tapped and leaves the rest where they are', () => {
        const next = bumpHome(NO_HOME, 'patients');

        expect(next).toEqual({ day: 0, patients: 1, stats: 0, settings: 0 });
    });

    it('counts up, so a second tap is a second signal and not a no-op', () => {
        const twice = bumpHome(bumpHome(NO_HOME, 'day'), 'day');

        expect(twice.day).toBe(2);
    });

    it('keeps the four tabs independent', () => {
        const next = bumpHome(bumpHome(NO_HOME, 'stats'), 'settings');

        expect(next).toEqual({ day: 0, patients: 0, stats: 1, settings: 1 });
    });

    it('does not mutate what it was given — the clusters read the old one until they re-render', () => {
        bumpHome(NO_HOME, 'day');

        expect(NO_HOME.day).toBe(0);
    });
});

describe('the disconnected route', () => {
    it('goes up the moment the connection says so, from any tab', () => {
        expect(nextRoute('app', 'offline')).toBe('offline');
    });

    it('comes down only on a confirmed answer', () => {
        expect(nextRoute('offline', 'online')).toBe('app');
    });

    it('sits still while a probe is running, which is what stops the flicker', () => {
        // `retry` and every re-probe pass through 'probing' on the way to an
        // answer: reading it either way flashes the stale app under the screen
        // she is on, or the screen over an app that is about to be told it is
        // fine.
        expect(nextRoute('offline', 'probing')).toBe('offline');
        expect(nextRoute('app', 'probing')).toBe('app');
    });

    it('sits still before anything has been asked', () => {
        expect(nextRoute('app', 'unknown')).toBe('app');
        expect(nextRoute('offline', 'unknown')).toBe('offline');
    });

    it('is idempotent — a second offline report does not re-enter it', () => {
        expect(nextRoute('offline', 'offline')).toBe('offline');
        expect(nextRoute('app', 'online')).toBe('app');
    });
});

describe('warming the tabs', () => {
    it('names every tab, so the warm-up mounts all of them and not the three it remembers', () => {
        expect([...ALL_TABS].sort()).toEqual(['day', 'patients', 'settings', 'stats']);
    });
});
