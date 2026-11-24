import { describe, expect, it } from 'bun:test';
import { clockSkew } from './clockCheck';

const at = Date.parse('2026-09-24T15:00:00Z');
const sample = (wall: number, mono = wall) => ({ wall, mono });

describe('the measured skew, off a slow reply', () => {
    it('is not taken from a reply too slow to place', () => {
        const phone = at + 60 * 60_000;
        expect(clockSkew(at, sample(phone), sample(phone + 45_000))).toBeNull();
    });
});

describe('the measured skew', () => {
    it('is the server clock less the midpoint of the round trip', () => {
        expect(clockSkew(at, sample(at + 60 * 60_000 - 100), sample(at + 60 * 60_000 + 100))).toBe(
            -60 * 60_000,
        );
    });

    it('is not taken from a round trip that ran backwards', () => {
        expect(clockSkew(at, sample(at + 60 * 60_000, 0), sample(at + 200, 200))).toBeNull();
    });

    it('is not taken when the phone time moved during the request', () => {
        expect(clockSkew(at, sample(at, 0), sample(at + 20_000, 200))).toBeNull();
    });
});
