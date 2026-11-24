import { describe, expect, test } from 'bun:test';
import { serverLabel } from './serverLabel';

const NONE = { lan: null, tailscale: null };

describe('serverLabel', () => {
    test('names the server actually answering, not the one configured first', () => {
        const both = { lan: 'http://192.168.1.20:3000', tailscale: 'http://clinic.ts.net:3000' };
        expect(serverLabel('http://clinic.ts.net:3000', both)).toBe('clinic.ts.net:3000');
    });

    test('falls back to the configured address before anything has answered', () => {
        expect(serverLabel(null, { lan: 'http://localhost:3000', tailscale: null })).toBe('localhost:3000');
        expect(serverLabel(null, { lan: null, tailscale: 'http://clinic.ts.net:3000/' })).toBe(
            'clinic.ts.net:3000',
        );
    });

    test('says so rather than naming an address on a build that has none', () => {
        expect(serverLabel(null, NONE)).toBe('no server');
    });
});
