/**
 * The "Last done" log: what this phone wrote, newest first, kept on the phone
 * and nowhere else.
 *
 * It holds patient names, so it is bounded twice — the last 30 actions or the
 * last seven days, whichever is fewer — and never leaves the device: nothing
 * here reaches a log, a breadcrumb or the server. A data reset (entering or
 * leaving the demo, a reseed) empties it, because the patients it names are no
 * longer the ones on the phone.
 *
 * `seenAt` is when the sheet was last opened. The button only draws attention
 * to itself for something newer than that.
 *
 * Storage is read on the first subscriber or the first write, whichever comes
 * first. A write can land before the Patients tab has ever been opened, and
 * writing it straight out would replace the stored log with a list of one.
 */
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

/** Newest first, no repeats, and nothing past either bound. */
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

/** Exported for the tests, which need a cold launch and a clock they can move. */
export function createLastDoneStore(key: string = KEY, now: () => number = Date.now) {
    let state: LastDoneState = { hydrated: false, entries: [], seenAt: 0 };
    const listeners = new Set<() => void>();
    let hydration: Promise<void> | null = null;
    /** Cleared while the read was out: what it brings back is the log that was just thrown away. */
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
                emit({
                    hydrated: true,
                    entries: prune([...state.entries, ...kept.entries], now()),
                    seenAt: Math.max(state.seenAt, kept.seenAt),
                });
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
        async add(entry: LastDoneEntry): Promise<void> {
            await hydrate();
            emit({ ...state, entries: prune([entry, ...state.entries], now()) });
            persist();
        },
        markSeen(): void {
            emit({ ...state, seenAt: Math.max(now(), state.entries[0]?.at ?? 0) });
            void hydrate().then(persist);
        },
        /** A demo's opening log (`demo.ts`): only into an empty one, and all of it new. */
        async seedIfEmpty(entries: readonly LastDoneEntry[]): Promise<void> {
            await hydrate();
            if (state.entries.length > 0 || entries.length === 0) return;
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
