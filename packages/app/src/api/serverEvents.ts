/**
 * The rules `live.ts` runs every `/ws` frame through, kept free of React Native
 * so `bun test` can reach them.
 *
 * The server numbers its events (`seq`) within one process (`epoch`) and
 * replays what a reconnecting phone missed. The cursor is this phone's half:
 * it drops what it has already applied, and asks for everything to be
 * refetched whenever it cannot prove it saw every event in between — a gap, a
 * restarted server, a protocol it does not know. Refetching is always safe
 * because an event only ever says what to refetch, so the worst a wrong call
 * here costs is one extra round of queries.
 */
import { WS_EVENT, WS_PROTOCOL_VERSION, WS_RESUME_PARAM, type WsEvent, type WsFrame } from '@lustre/shared';

export type ServerEvent = Extract<WsFrame, { type: 'event' }>;

type Outcome = 'applied' | 'duplicate' | 'resync' | 'ignored';

interface Step {
    outcome: Outcome;
    /** Everything is stale: refetch every query, not only what `event` touched. */
    resync: boolean;
    event: ServerEvent | null;
}

const IGNORED: Step = { outcome: 'ignored', resync: false, event: null };

function isWsEvent(value: unknown): value is WsEvent {
    return Object.values(WS_EVENT).includes(value as WsEvent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

export function createEventCursor() {
    let epoch: string | null = null;
    let seq = 0;

    return {
        /** The query string a reconnect resumes with; empty before the first `hello`. */
        resumeQuery(): string {
            if (epoch === null) return '';
            return `?${WS_RESUME_PARAM.EPOCH}=${encodeURIComponent(epoch)}&${WS_RESUME_PARAM.SINCE}=${seq}`;
        },

        read(frame: unknown): Step {
            if (!isRecord(frame)) return IGNORED;
            if (frame.v !== WS_PROTOCOL_VERSION) {
                epoch = null;
                seq = 0;
                return { outcome: 'resync', resync: true, event: null };
            }
            if (typeof frame.epoch !== 'string' || !Number.isSafeInteger(frame.seq)) return IGNORED;
            const at = frame.seq as number;

            if (frame.type === 'hello') {
                const lost = frame.resync === true || frame.epoch !== epoch || at !== seq;
                epoch = frame.epoch;
                seq = at;
                return lost ? { outcome: 'resync', resync: true, event: null } : IGNORED;
            }

            if (frame.type !== 'event') return IGNORED;
            if (frame.epoch === epoch && at <= seq) {
                return { outcome: 'duplicate', resync: false, event: null };
            }

            const gap = frame.epoch !== epoch || at !== seq + 1;
            epoch = frame.epoch;
            seq = at;

            // A name this build does not know is still a change it did not see.
            if (!isWsEvent(frame.event) || typeof frame.at !== 'number') {
                return { outcome: 'resync', resync: true, event: null };
            }
            const event: ServerEvent = {
                v: WS_PROTOCOL_VERSION,
                type: 'event',
                epoch: frame.epoch,
                seq: at,
                at: frame.at,
                event: frame.event,
                ...(typeof frame.id === 'string' ? { id: frame.id } : {}),
            };
            return { outcome: gap ? 'resync' : 'applied', resync: gap, event };
        },
    };
}

/** The routers whose queries an event can have made stale. */
export type Area =
    | 'appointment'
    | 'backup'
    | 'balance'
    | 'branch'
    | 'customQuestion'
    | 'device'
    | 'patient'
    | 'procedure'
    | 'reminder'
    | 'settings'
    | 'stats'
    | 'visit';

const REFRESHES: Record<WsEvent, readonly Area[]> = {
    [WS_EVENT.APPOINTMENT_CREATED]: ['appointment', 'reminder', 'stats'],
    [WS_EVENT.APPOINTMENT_UPDATED]: ['appointment', 'reminder', 'stats'],
    [WS_EVENT.VISIT_COMPLETED]: ['appointment', 'visit', 'stats'],
    [WS_EVENT.APPOINTMENT_CHECKED_IN]: ['appointment', 'visit', 'stats'],
    [WS_EVENT.VISIT_UPDATED]: ['visit', 'balance', 'patient', 'appointment', 'stats'],
    // The pending list is rendered from the settings: the template is its
    // wording and the lead time is which reminders are on it at all, and a new
    // lead time moves the ones already booked.
    [WS_EVENT.SETTINGS_UPDATED]: ['settings', 'reminder', 'backup'],
    // Rows carry the patient's name wherever the patient appears.
    [WS_EVENT.PATIENT_UPDATED]: ['patient', 'appointment', 'reminder', 'balance', 'stats'],
    [WS_EVENT.REMINDER_UPDATED]: ['reminder'],
    [WS_EVENT.CATALOG_UPDATED]: ['branch', 'procedure', 'customQuestion'],
    [WS_EVENT.DEVICES_UPDATED]: ['device'],
};

/**
 * Folds the events handled in one turn into one refetch per router: a resync
 * and the event that revealed the gap, or `hello` and what it closes. A
 * microtask rather than a timer, because Android stops JS timers while the app
 * is in the background and this has to run there.
 */
export function createRefreshBatch(
    run: (areas: ReadonlySet<Area> | 'all') => void,
    defer: (flush: () => void) => void = queueMicrotask,
) {
    let pending: Set<Area> | 'all' | null = null;

    return (next: WsEvent | 'all'): void => {
        const scheduled = pending !== null;
        if (next === 'all' || pending === 'all') {
            pending = 'all';
        } else {
            pending ??= new Set();
            for (const area of REFRESHES[next]) pending.add(area);
        }
        if (scheduled) return;
        defer(() => {
            const areas = pending;
            pending = null;
            if (areas) run(areas);
        });
    };
}
