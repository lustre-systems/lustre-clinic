import { describe, expect, it } from 'bun:test';
import { noAnswer, nothingEntered, toBase, toCandidate } from './address';

describe('toBase', () => {
    it('assumes http for a bare host, which is how the address is read aloud', () => {
        expect(toBase('192.168.1.20:3000')).toBe('http://192.168.1.20:3000');
        expect(toBase('clinic-pc.tailnet.ts.net:3000')).toBe('http://clinic-pc.tailnet.ts.net:3000');
    });

    it('keeps a scheme the user typed, in either case', () => {
        expect(toBase('http://192.168.1.20:3000')).toBe('http://192.168.1.20:3000');
        expect(toBase('https://clinic-pc.tailnet.ts.net')).toBe('https://clinic-pc.tailnet.ts.net');
        expect(toBase('HTTP://192.168.1.20:3000')).toBe('HTTP://192.168.1.20:3000');
    });

    it('strips trailing slashes, which `trpcUrl` would otherwise double', () => {
        expect(toBase('http://192.168.1.20:3000/')).toBe('http://192.168.1.20:3000');
        expect(toBase('192.168.1.20:3000///')).toBe('http://192.168.1.20:3000');
    });

    it('survives the spaces a phone keyboard adds', () => {
        expect(toBase('  192.168.1.20:3000  ')).toBe('http://192.168.1.20:3000');
    });

    it('reports an empty field as empty rather than as a bare scheme', () => {
        expect(toBase('')).toBe('');
        expect(toBase('   ')).toBe('');
        expect(toBase('/')).toBe('');
    });
});

describe('noAnswer', () => {
    it('counts the addresses that were actually tried', () => {
        expect(noAnswer({ lan: 'http://a:3000', tailscale: 'http://b:3000' })).toStartWith(
            'Neither address answered',
        );
        expect(noAnswer({ lan: 'http://a:3000', tailscale: '' })).toStartWith('That address did not answer');
    });

    it('mentions the clinic wifi only when a LAN address was tried', () => {
        expect(noAnswer({ lan: 'http://a:3000', tailscale: 'http://b:3000' })).toContain('clinic wifi');
        expect(noAnswer({ lan: '', tailscale: 'http://b:3000' })).not.toContain('wifi');
    });
});

describe('prod setup', () => {
    it('drops a typed or restored LAN address when the build does not allow one', () => {
        const typed = { lan: '192.168.1.20:3000', tailscale: 'smilemakers.tailad17f9.ts.net:3000' };
        expect(toCandidate(typed, false)).toEqual({
            lan: '',
            tailscale: 'http://smilemakers.tailad17f9.ts.net:3000',
        });
        expect(noAnswer(toCandidate(typed, false))).not.toContain('wifi');
    });

    it('keeps both addresses where the LAN is allowed', () => {
        expect(toCandidate({ lan: 'localhost:3000', tailscale: '' }, true)).toEqual({
            lan: 'http://localhost:3000',
            tailscale: '',
        });
    });

    it('asks for the one field there is', () => {
        expect(nothingEntered(false)).toBe('Enter the Tailscale address.');
        expect(nothingEntered(true)).toBe('Enter at least one address.');
    });
});
