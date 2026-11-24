import AsyncStorage from '@react-native-async-storage/async-storage';
import { LAST_DONE_KINDS, type LastDoneEntry } from './entry';

export const MAX_ENTRIES = 30;
export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const KEY = 'lustre.lastDone';

export interface LastDoneState {
    hydrated: boolean;
    entries: readonly LastDoneEntry[];
    seenAt: number;
}

const KINDS: ReadonlySet<string> = new Set(LAST_DONE_KINDS);

function isEntry(value: unknown): value is LastDoneEntry {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Partial<LastDoneEntry>;
    return (
        typeof entry.id === 'string' &&
        typeof entry.kind === 'string' &&
        KINDS.has(entry.kind) &&
        typeof entry.at === 'number' &&
        Number.isFinite(entry.at)
    );
}

function parse(stored: string | null): { entries: LastDoneEntry[]; seenAt: number } {
    try {
        const value: unknown = stored === null ? null : JSON.parse(stored);
        const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
        const entries = Array.isArray(record.entries) ? record.entries.filter(isEntry) : [];
        const seenAt = typeof record.seenAt === 'number' ? record.seenAt : 0;
        return { entries, seenAt };
    } catch {
        return { entries: [], seenAt: 0 };
    }
}

export function prune(entries: readonly LastDoneEntry[], now: number): LastDoneEntry[] {
    const seen = new Set<string>();
    return [...entries]
        .sort((a, b) => b.at - a.at)
        .filter((entry) => now - entry.at < MAX_AGE_MS && !seen.has(entry.id) && seen.add(entry.id))
        .slice(0, MAX_ENTRIES);
}

export function hasUnseen(state: LastDoneState): boolean {
    const newest = state.entries[0];
    return newest !== undefined && newest.at > state.seenAt;
}

export function createLastDoneStore(key: string = KEY, now: () => number = Date.now) {
    let state: LastDoneState = { hydrated: false, entries: [], seenAt: 0 };
    const listeners = new Set<() => void>();
    let hydration: Promise<void> | null = null;
    let discarded = false;

    function emit(next: LastDoneState): void {
        state = next;
        for (const listener of listeners) listener();
    }

    function persist(): void {
        const body = JSON.stringify({ entries: state.entries, seenAt: state.seenAt });
        void AsyncStorage.setItem(key, body).catch(() => undefined);
    }

    function hydrate(): Promise<void> {
        hydration ??= AsyncStorage.getItem(key)
            .catch(() => null)
            .then((stored) => {
                const kept = discarded ? parse(null) : parse(stored);
                const merged = [...state.entries, ...kept.entries];
                const entries = prune(merged, now());
                emit({ hydrated: true, entries, seenAt: Math.max(state.seenAt, kept.seenAt) });
                if (entries.length !== merged.length) persist();
            });
        return hydration;
    }

    return {
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            void hydrate();
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot: (): LastDoneState => state,
        async add(entry: LastDoneEntry, current: () => boolean = () => true): Promise<void> {
            await hydrate();
            if (!current()) return;
            emit({ ...state, entries: prune([entry, ...state.entries], now()) });
            persist();
        },
        markSeen(): void {
            emit({ ...state, seenAt: Math.max(now(), state.entries[0]?.at ?? 0) });
            void hydrate().then(persist);
        },
        async seedIfEmpty(
            entries: readonly LastDoneEntry[],
            current: () => boolean = () => true,
        ): Promise<void> {
            await hydrate();
            if (!current() || state.entries.length > 0 || entries.length === 0) return;
            emit({ ...state, entries: prune(entries, now()), seenAt: 0 });
            persist();
        },
        clear(): void {
            discarded = true;
            emit({ ...state, entries: [], seenAt: 0 });
            void AsyncStorage.removeItem(key).catch(() => undefined);
        },
    };
}

export const lastDone = createLastDoneStore();
