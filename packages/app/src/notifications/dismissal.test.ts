import { describe, expect, it } from 'bun:test';
import type { AlarmDismissal } from '../../modules/lustre-alarm';
import { createDismissalSync, effectiveDismissedOn } from './dismissal';
import { planNudges } from './schedule';

const TODAY = '2026-10-06';

/** The native side's file, the server, and a clock, as the sync sees them. */
function harness(held: AlarmDismissal | null, { failures = 0 } = {}) {
    const state = {
        held,
        sent: [] as string[],
        failuresLeft: failures,
        retries: [] as Array<() => void>,
        rereads: 0,
        rearms: 0,
        today: TODAY,
        now: 1_000,
    };
    const sync = createDismissalSync({
        read: () => state.held,
        send: async (day) => {
            if (state.failuresLeft > 0) {
                state.failuresLeft -= 1;
                throw new Error('unreachable');
            }
            state.sent.push(day);
        },
        markSent: (day) => {
            if (state.held?.day === day) state.held = { day, sent: true };
        },
        clear: () => {
            state.held = null;
        },
        today: () => state.today,
        reread: () => {
            state.rereads += 1;
        },
        rearm: () => {
            state.rearms += 1;
        },
        later: (retry) => {
            state.retries.push(retry);
            return () => {
                state.retries = state.retries.filter((queued) => queued !== retry);
            };
        },
        retryMs: 60_000,
        now: () => state.now,
    });
    return { state, sync };
}

describe('effectiveDismissedOn', () => {
    it("counts this phone's press for today before the server has it", () => {
        expect(effectiveDismissedOn(null, { day: TODAY, sent: false }, TODAY)).toBe(TODAY);
    });

    it("goes by the server for any other day's press, or none", () => {
        expect(effectiveDismissedOn(null, { day: '2026-10-05', sent: false }, TODAY)).toBeNull();
        expect(effectiveDismissedOn('2026-10-05', null, TODAY)).toBe('2026-10-05');
        expect(effectiveDismissedOn(TODAY, null, TODAY)).toBe(TODAY);
    });

    it('arms nothing for the rest of the day once pressed, and tomorrow arms as usual', () => {
        const input = {
            notifyAt: 9 * 60,
            repeatMinutes: 30,
            pendingCount: 3,
            today: TODAY,
            now: Date.parse('2026-10-06T07:00:00Z'),
        };
        const held = { day: TODAY, sent: false };
        expect(planNudges({ ...input, dismissedOn: effectiveDismissedOn(null, held, TODAY) }).silent).toBe(
            'dismissed',
        );

        const tomorrow = '2026-10-07';
        const next = planNudges({
            ...input,
            today: tomorrow,
            now: Date.parse('2026-10-07T05:00:00Z'),
            dismissedOn: effectiveDismissedOn(TODAY, held, tomorrow),
        });
        expect(next.silent).toBe('pending');
        expect(next.at.length).toBeGreaterThan(0);
    });
});

describe('createDismissalSync', () => {
    it("sends today's press, marks it sent, and re-reads the settings", async () => {
        const { state, sync } = harness({ day: TODAY, sent: false });
        await sync.sync();
        expect(state.sent).toEqual([TODAY]);
        expect(state.held).toEqual({ day: TODAY, sent: true });
        expect(state.rearms).toBe(1);
    });

    it('sends nothing when nothing was pressed, or it was already sent', async () => {
        const none = harness(null);
        await none.sync.sync();
        expect(none.state.sent).toEqual([]);

        const done = harness({ day: TODAY, sent: true });
        await done.sync.sync();
        expect(done.state.sent).toEqual([]);
        expect(done.state.held).toEqual({ day: TODAY, sent: true });
    });

    it("drops an older day's press unsent, so it never overwrites today's", async () => {
        const { state, sync } = harness({ day: '2026-10-05', sent: false });
        await sync.sync();
        expect(state.sent).toEqual([]);
        expect(state.held).toBeNull();
        expect(state.rereads).toBe(1);
    });

    it('keeps the press and tries again later while the server is out of reach', async () => {
        const { state, sync } = harness({ day: TODAY, sent: false }, { failures: 2 });
        await sync.sync();
        expect(state.held).toEqual({ day: TODAY, sent: false });
        expect(state.retries).toHaveLength(1);

        state.retries[0]?.();
        await Bun.sleep(0);
        expect(state.sent).toEqual([]);
        expect(state.retries).toHaveLength(1);

        const retry = state.retries[0];
        retry?.();
        await Bun.sleep(0);
        expect(state.sent).toEqual([TODAY]);
        expect(state.held).toEqual({ day: TODAY, sent: true });
        expect(state.retries).toHaveLength(0);
    });

    it('holds one retry, not one per trigger', async () => {
        const { state, sync } = harness({ day: TODAY, sent: false }, { failures: 5 });
        await sync.sync();
        await sync.sync();
        await sync.sync();
        expect(state.retries).toHaveLength(1);
        sync.stop();
        expect(state.retries).toHaveLength(0);
    });

    it('sends once when asked twice at the same moment', async () => {
        const { state, sync } = harness({ day: TODAY, sent: false });
        await Promise.all([sync.sync(), sync.sync()]);
        expect(state.sent).toEqual([TODAY]);
    });

    it('forgets the press once settings read after the send come in, not before', async () => {
        const { state, sync } = harness({ day: TODAY, sent: false });
        state.now = 5_000;
        await sync.sync();

        sync.settle(4_000);
        expect(state.held).toEqual({ day: TODAY, sent: true });

        sync.settle(6_000);
        expect(state.held).toBeNull();
    });

    it('never forgets a press the server does not have yet', () => {
        const { state, sync } = harness({ day: TODAY, sent: false });
        sync.settle(Number.MAX_SAFE_INTEGER);
        expect(state.held).toEqual({ day: TODAY, sent: false });
    });

    it('forgets a press sent by an earlier launch on the first settings read', () => {
        const { state, sync } = harness({ day: TODAY, sent: true });
        sync.settle(1);
        expect(state.held).toBeNull();
    });
});
