import { WS_EVENT, WS_PROTOCOL_VERSION, WS_RESUME_PARAM, type WsEvent, type WsFrame } from '@lustre/shared';

export type ServerEvent = Extract<WsFrame, { type: 'event' }>;

type Outcome = 'applied' | 'duplicate' | 'resync' | 'ignored';

interface Step {
    outcome: Outcome;
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
    [WS_EVENT.SETTINGS_UPDATED]: ['settings', 'reminder', 'backup'],
    [WS_EVENT.PATIENT_UPDATED]: ['patient', 'appointment', 'reminder', 'balance', 'stats'],
    [WS_EVENT.REMINDER_UPDATED]: ['reminder'],
    [WS_EVENT.CATALOG_UPDATED]: ['branch', 'procedure', 'customQuestion'],
    [WS_EVENT.DEVICES_UPDATED]: ['device'],
};

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
