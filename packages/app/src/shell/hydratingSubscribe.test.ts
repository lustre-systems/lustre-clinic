import { describe, expect, it } from 'bun:test';
import { hydratingSubscribe } from './hydratingSubscribe';

describe('hydratingSubscribe', () => {
    it('adds the listener and starts hydration on the first subscriber only', () => {
        const listeners = new Set<() => void>();
        let hydrations = 0;
        const subscribe = hydratingSubscribe(listeners, async () => {
            hydrations += 1;
        });

        const first = () => {};
        const second = () => {};
        subscribe(first);
        subscribe(second);

        expect(hydrations).toBe(1);
        expect([...listeners]).toEqual([first, second]);
    });

    it('does not hydrate again after every listener has left', () => {
        const listeners = new Set<() => void>();
        let hydrations = 0;
        const subscribe = hydratingSubscribe(listeners, async () => {
            hydrations += 1;
        });

        const listener = () => {};
        subscribe(listener)();
        expect(listeners.size).toBe(0);

        subscribe(listener);
        expect(hydrations).toBe(1);
        expect(listeners.has(listener)).toBe(true);
    });

    it('does not import anything native, so it runs under bun test', async () => {
        const source = await Bun.file(new URL('./hydratingSubscribe.ts', import.meta.url)).text();
        expect(source).not.toMatch(/^import /m);
    });
});
