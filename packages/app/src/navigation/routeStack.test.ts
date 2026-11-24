import { describe, expect, it } from 'bun:test';
import {
    beneath,
    canPop,
    clear,
    emptyStack,
    isOpen,
    isTop,
    pop,
    popToRoot,
    push,
    type RouteStack,
    rendered,
    replaceTop,
    resetTo,
    settled,
    top,
} from './routeStack';

type Route = 'record' | 'edit' | 'visit';

function stackOf(...open: Route[]): RouteStack<Route> {
    return open.reduce<RouteStack<Route>>(push, emptyStack<Route>());
}

function drawn(stack: RouteStack<Route>): Route[] {
    return rendered(stack).map((entry) => entry.route);
}

function ids(stack: RouteStack<Route>): number[] {
    return rendered(stack).map((entry) => entry.id);
}

describe('routeStack', () => {
    it('starts at the root with nothing to pop', () => {
        const stack = emptyStack<Route>();

        expect(top(stack)).toBeUndefined();
        expect(beneath(stack)).toBeUndefined();
        expect(canPop(stack)).toBe(false);
        expect(drawn(stack)).toEqual([]);
    });

    it('stacks bottom to top', () => {
        const stack = stackOf('record', 'edit');

        expect(drawn(stack)).toEqual(['record', 'edit']);
        expect(top(stack)).toBe('edit');
        expect(beneath(stack)).toBe('record');
        expect(canPop(stack)).toBe(true);
    });

    it('keeps a popped route drawn until it has finished leaving', () => {
        const popped = pop(stackOf('record', 'edit'));

        expect(top(popped)).toBe('record');
        expect(drawn(popped)).toEqual(['record', 'edit']);
        expect(isOpen(popped, 0)).toBe(true);
        expect(isOpen(popped, 1)).toBe(false);

        expect(drawn(settled(popped))).toEqual(['record']);
    });

    it('draws a leaving route above the one it was stacked on', () => {
        const twice = pop(pop(stackOf('record', 'edit', 'visit')));

        expect(twice.open.map((entry) => entry.route)).toEqual(['record']);
        expect(twice.leaving.map((entry) => entry.route)).toEqual(['edit', 'visit']);
        expect(drawn(twice)).toEqual(['record', 'edit', 'visit']);
    });

    it('drops leaving routes topmost first, one report at a time', () => {
        const twice = pop(pop(stackOf('record', 'edit')));

        expect(drawn(twice)).toEqual(['record', 'edit']);
        expect(drawn(settled(twice))).toEqual(['record']);
        expect(drawn(settled(settled(twice)))).toEqual([]);
        expect(drawn(settled(settled(settled(twice))))).toEqual([]);
    });

    it('pops nothing at the root', () => {
        const root = emptyStack<Route>();

        expect(pop(root)).toEqual(root);
        expect(popToRoot(root)).toEqual(root);
    });

    it('sends every route out together on popToRoot', () => {
        const home = popToRoot(stackOf('record', 'edit', 'visit'));

        expect(home.open).toEqual([]);
        expect(drawn(home)).toEqual(['record', 'edit', 'visit']);
        expect(canPop(home)).toBe(false);
    });

    it('clears anything mid-slide when a new route is pushed', () => {
        const reopened = push(pop(stackOf('record')), 'edit');

        expect(drawn(reopened)).toEqual(['edit']);
    });

    it('refuses the second of two taps on the same opener', () => {
        const twice = push(stackOf('record', 'edit'), 'edit');

        expect(drawn(twice)).toEqual(['record', 'edit']);
    });

    it('compares a route by value, not by identity', () => {
        type Editor = { kind: string; id?: string };
        const first = push(emptyStack<Editor>(), { kind: 'new' });
        const second = push(first, { kind: 'new' });

        expect(rendered(second)).toHaveLength(1);
        expect(rendered(push(first, { kind: 'edit', id: 'p1' }))).toHaveLength(2);

        const one = push(emptyStack<Editor>(), { kind: 'edit', id: 'p1' });
        const two = push(one, { kind: 'edit', id: 'p2' });
        expect(rendered(two)).toHaveLength(2);
        expect(two.open.map((entry) => entry.route)).toEqual([
            { kind: 'edit', id: 'p1' },
            { kind: 'edit', id: 'p2' },
        ]);
    });

    it('reopens a route once its pane has been popped', () => {
        const again = push(pop(stackOf('record', 'edit')), 'edit');

        expect(top(again)).toBe('edit');
        expect(again.open).toHaveLength(2);
    });

    it('stacks the same route reached from itself', () => {
        const deeper = push(push(stackOf('record'), 'edit'), 'record');

        expect(drawn(deeper)).toEqual(['record', 'edit', 'record']);
    });

    it('swaps the top without a pop', () => {
        const saved = replaceTop(stackOf('record', 'edit'), 'record');

        expect(drawn(saved)).toEqual(['record', 'record']);
        expect(saved.leaving).toEqual([]);
    });

    it('pushes when there is no top to replace', () => {
        expect(drawn(replaceTop(emptyStack<Route>(), 'record'))).toEqual(['record']);
    });

    it('drops everything but the one route on resetTo', () => {
        const jumped = resetTo(stackOf('record', 'edit'), 'record');

        expect(drawn(jumped)).toEqual(['record']);
        expect(jumped.leaving).toEqual([]);
    });

    describe('identity', () => {
        it('gives every drawn entry a distinct id', () => {
            const stack = stackOf('record', 'edit', 'visit');

            expect(new Set(ids(stack)).size).toBe(3);
        });

        it('keeps an id when its route is popped and is still leaving', () => {
            const stack = stackOf('record', 'edit');
            const before = ids(stack);

            expect(ids(pop(stack))).toEqual(before);
        });

        it('gives a replacement at the same depth a new id', () => {
            const first = stackOf('edit');
            const second = resetTo(first, 'edit');

            expect(ids(second)).not.toEqual(ids(first));
        });

        it('does not reuse an id still held by a route on its way out', () => {
            const leavingOne = pop(stackOf('record'));
            const withNew = { ...leavingOne, open: push(leavingOne, 'edit').open };

            expect(new Set([...ids(leavingOne), ...withNew.open.map((e) => e.id)]).size).toBe(2);
        });

        it('replaceTop gives the new route its own id', () => {
            const stack = stackOf('record', 'edit');
            const saved = replaceTop(stack, 'record');

            expect(saved.open[1]?.id).not.toBe(stack.open[1]?.id);
        });
    });

    describe('isTop', () => {
        it('matches nothing at the root', () => {
            expect(isTop(emptyStack<Route>(), 0)).toBe(false);
        });

        it('matches the entry that was pushed last', () => {
            const stack = stackOf('record', 'edit');

            expect(isTop(stack, stack.open[1]?.id ?? -1)).toBe(true);
            expect(isTop(stack, stack.open[0]?.id ?? -1)).toBe(false);
        });

        it('stops matching a route that is only still sliding out', () => {
            const stack = stackOf('record', 'edit');
            const popped = pop(stack);

            expect(isTop(popped, stack.open[1]?.id ?? -1)).toBe(false);
        });

        it('stops matching however the stack is moved', () => {
            const stack = stackOf('record', 'edit');
            const was = stack.open[1]?.id ?? -1;

            for (const moved of [
                pop(stack),
                popToRoot(stack),
                push(stack, 'visit'),
                replaceTop(stack, 'record'),
                resetTo(stack, 'record'),
            ]) {
                expect(isTop(moved, was)).toBe(false);
            }
        });
    });

    it('drops open and leaving routes together on clear', () => {
        const cleared = clear(pop(stackOf('record', 'edit')));

        expect(drawn(cleared)).toEqual([]);
        expect(canPop(cleared)).toBe(false);
    });

    it('never mutates the stack it was given', () => {
        const stack = stackOf('record', 'edit');
        const before = drawn(stack);

        clear(stack);
        pop(stack);
        popToRoot(stack);
        push(stack, 'visit');
        replaceTop(stack, 'visit');
        resetTo(stack, 'visit');
        settled(stack);

        expect(drawn(stack)).toEqual(before);
    });
});
