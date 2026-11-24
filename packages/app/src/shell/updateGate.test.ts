import { describe, expect, it } from 'bun:test';
import {
    isMinorUpdate,
    manifestVersion,
    manifestWantsScreen,
    RELOAD_WINDOW_MS,
    reloadOnReturn,
    updatesHeld,
    withUpdatesHeld,
} from './updateGate';

describe('isMinorUpdate', () => {
    it('stops the phone for a new minor or major', () => {
        expect(isMinorUpdate('1.5.2', '1.6.0')).toBe(true);
        expect(isMinorUpdate('1.5.2', '2.0.0')).toBe(true);
    });

    it('leaves a patch to the next launch', () => {
        expect(isMinorUpdate('1.5.1', '1.5.2')).toBe(false);
        expect(isMinorUpdate('1.6.0', '1.6.3')).toBe(false);
    });

    it('never stops for an update that is not newer', () => {
        expect(isMinorUpdate('1.6.0', '1.5.9')).toBe(false);
        expect(isMinorUpdate('2.0.0', '1.9.0')).toBe(false);
    });

    it('treats a number it cannot read as a patch', () => {
        expect(isMinorUpdate(null, '1.6.0')).toBe(false);
        expect(isMinorUpdate('1.5.2', null)).toBe(false);
        expect(isMinorUpdate('0.0.0-dev', '1.6.0')).toBe(false);
    });
});

describe('manifestVersion', () => {
    it('reads the number the update was published as', () => {
        expect(manifestVersion({ id: 'x', metadata: { version: '1.6.0' } })).toBe('1.6.0');
    });

    it('is null for a manifest without one', () => {
        expect(manifestVersion({ id: 'x', metadata: {} })).toBeNull();
        expect(manifestVersion({ id: 'x' })).toBeNull();
        expect(manifestVersion(undefined)).toBeNull();
    });
});

describe('manifestWantsScreen', () => {
    it('takes the screen for a patch shipped with --screen', () => {
        expect(manifestWantsScreen({ metadata: { version: '1.7.1', screen: 'true' } })).toBe(true);
    });

    it('stays quiet for any other manifest', () => {
        expect(manifestWantsScreen({ metadata: { version: '1.7.1' } })).toBe(false);
        expect(manifestWantsScreen({ metadata: { screen: true } })).toBe(false);
        expect(manifestWantsScreen(undefined)).toBe(false);
    });
});

describe('reloadOnReturn', () => {
    it('restarts into a downloaded update on any return to the app', () => {
        expect(reloadOnReturn(true, 0, false)).toBe(true);
        expect(reloadOnReturn(true, RELOAD_WINDOW_MS - 1, false)).toBe(true);
    });

    it('leaves an update that lands later to the next return', () => {
        expect(reloadOnReturn(true, RELOAD_WINDOW_MS, false)).toBe(false);
    });

    it('never restarts in the middle of a flow that left the app', () => {
        expect(reloadOnReturn(true, 0, true)).toBe(false);
    });

    it('does nothing without a downloaded update, or before any return', () => {
        expect(reloadOnReturn(false, 0, false)).toBe(false);
        expect(reloadOnReturn(true, null, false)).toBe(false);
    });
});

describe('withUpdatesHeld', () => {
    it('holds updates until the flow ends, however it ends', async () => {
        const during = withUpdatesHeld(async () => updatesHeld());
        expect(await during).toBe(true);
        expect(updatesHeld()).toBe(false);

        await withUpdatesHeld(async () => {
            throw new Error('cancelled');
        }).catch(() => undefined);
        expect(updatesHeld()).toBe(false);
    });
});
