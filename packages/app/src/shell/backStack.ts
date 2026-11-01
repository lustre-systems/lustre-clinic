// Where the hardware back goes. There is no navigator (SPEC §18 F3), so there
// is no stack to pop: each cluster holds its own route in state and the four of
// them stay mounted side by side. That leaves two questions this file answers,
// both as data so `bun test` can reach them — a renderer cannot.
//
// **Which handler.** One stack per tab, because only the tab that is up may
// answer. The three behind it are mounted and may well be holding a pushed
// screen, and popping one nobody is looking at is a back press that appears to
// do nothing.
//
// **What order.** Handlers are asked newest-first and the first to claim the
// press wins, so a screen pushed over another answers before it. The order is
// registration order, which is mount order, which is the order the user opened
// them in — and that only holds because a handler registers when its component
// mounts and stays registered, deciding for itself whether it has anything to
// pop. A handler that registered and unregistered as its screen opened and
// closed would be ordered by React's effect timing instead, and effects run
// children-first: a screen and the pane pushed over it arriving in the same
// commit would register inside-out, and back would pop the wrong one.
//
// So: register once, return `false` when there is nothing to pop, and let the
// press fall through.
import type { TabKey } from '../components/domain';

/** Answers a back press, or declines it. `true` means handled. */
export type BackHandler = () => boolean;

export type BackStack = {
    /** Registers for the life of a component. Returns the way to unregister. */
    push(handler: BackHandler): () => void;
    /** Asks each handler newest-first. `true` once one has claimed the press. */
    run(): boolean;
};

export function createBackStack(): BackStack {
    const handlers: BackHandler[] = [];

    return {
        push(handler) {
            handlers.push(handler);
            return () => {
                const at = handlers.indexOf(handler);
                if (at !== -1) handlers.splice(at, 1);
            };
        },
        run() {
            // Walked over a copy, and checked against the live array as it
            // goes. A handler that pops a screen unmounts it, and the unmount
            // takes that screen's handler out — walking the live array directly
            // would shuffle the remaining ones under the cursor and skip one,
            // and walking the copy alone would ask a handler whose screen has
            // already gone.
            for (const handler of [...handlers].reverse()) {
                if (!handlers.includes(handler)) continue;
                if (handler()) return true;
            }
            return false;
        },
    };
}

export type BackStacks = Record<TabKey, BackStack>;

export function createBackStacks(): BackStacks {
    return {
        day: createBackStack(),
        patients: createBackStack(),
        stats: createBackStack(),
        settings: createBackStack(),
    };
}

/**
 * What back means once the tab that is up has nothing left to pop.
 *
 * The day is home — it is where the app opens and the tab the desk works from —
 * so back from another tab's root returns there rather than leaving. From the
 * day's own root there is nowhere further in, and back does what back does
 * everywhere else on Android: it leaves the app. `null` says so.
 */
export function backFromRoot(tab: TabKey): TabKey | null {
    return tab === 'day' ? null : 'day';
}
