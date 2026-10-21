import { describe, expect, it } from 'bun:test';
import { backFromRoot, createBackStack, createBackStacks } from './backStack';

describe('createBackStack', () => {
    it('has nothing to say when nothing has registered', () => {
        expect(createBackStack().run()).toBe(false);
    });

    it('asks the newest handler first', () => {
        const stack = createBackStack();
        const asked: string[] = [];

        stack.push(() => {
            asked.push('cluster');
            return true;
        });
        stack.push(() => {
            asked.push('pushed screen');
            return true;
        });

        expect(stack.run()).toBe(true);
        expect(asked).toEqual(['pushed screen']);
    });

    it('falls through a handler that declines', () => {
        const stack = createBackStack();
        const asked: string[] = [];

        stack.push(() => {
            asked.push('cluster');
            return true;
        });
        stack.push(() => {
            asked.push('pushed screen');
            return false;
        });

        expect(stack.run()).toBe(true);
        expect(asked).toEqual(['pushed screen', 'cluster']);
    });

    it('declines the press when every handler does', () => {
        const stack = createBackStack();
        stack.push(() => false);
        stack.push(() => false);

        expect(stack.run()).toBe(false);
    });

    it('stops asking a handler that has unregistered', () => {
        const stack = createBackStack();
        const remove = stack.push(() => true);

        remove();

        expect(stack.run()).toBe(false);
    });

    // Popping a screen unmounts it, which takes its handler with it. Whether
    // that lands inside the press or after it, the walk must neither skip the
    // handler underneath nor ask the one that has gone.
    it('skips a handler unregistered mid-press without losing the one below', () => {
        const stack = createBackStack();
        const asked: string[] = [];

        stack.push(() => {
            asked.push('cluster');
            return true;
        });
        const removeMiddle = stack.push(() => {
            asked.push('middle');
            return false;
        });
        stack.push(() => {
            asked.push('top');
            removeMiddle();
            return false;
        });

        expect(stack.run()).toBe(true);
        expect(asked).toEqual(['top', 'cluster']);
    });

    it('keeps one stack per tab', () => {
        const stacks = createBackStacks();
        stacks.patients.push(() => true);

        expect(stacks.patients.run()).toBe(true);
        expect(stacks.day.run()).toBe(false);
        expect(stacks.stats.run()).toBe(false);
        expect(stacks.settings.run()).toBe(false);
    });
});

describe('backFromRoot', () => {
    it('sends every other tab back to the day', () => {
        expect(backFromRoot('patients')).toBe('day');
        expect(backFromRoot('stats')).toBe('day');
        expect(backFromRoot('settings')).toBe('day');
    });

    it('leaves the app from the day, which is home', () => {
        expect(backFromRoot('day')).toBeNull();
    });
});
