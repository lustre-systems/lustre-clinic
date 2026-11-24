import type { TabKey } from '../components/domain';

export type BackHandler = () => boolean;

export type BackStack = {
    push(handler: BackHandler): () => void;
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

export function backFromRoot(tab: TabKey): TabKey | null {
    return tab === 'day' ? null : 'day';
}
