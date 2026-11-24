import {
    WS_CLOSE_REFUSED,
    WS_PROTOCOL_VERSION,
    WS_RESUME_PARAM,
    type WsEvent,
    type WsFrame,
} from '@lustre/shared';
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { logger } from '../logger.ts';

export interface Resume {
    epoch: string;
    since: number;
}

export interface WsData {
    connectedAt: number;
    resume: Resume | null;
    deviceId: string | null;
}

type Socket = ServerWebSocket<WsData>;
type EventFrame = Extract<WsFrame, { type: 'event' }>;

const REPLAY_LIMIT = 256;

const epoch = Bun.randomUUIDv7();
let seq = 0;
const recent: EventFrame[] = [];

const sockets = new Set<Socket>();

export function resumeFrom(url: URL): Resume | null {
    const from = url.searchParams.get(WS_RESUME_PARAM.EPOCH);
    const since = Number(url.searchParams.get(WS_RESUME_PARAM.SINCE));
    if (!from || !Number.isSafeInteger(since) || since < 0) return null;
    return { epoch: from, since };
}

function replayFor(resume: Resume | null): EventFrame[] | null {
    if (!resume || resume.epoch !== epoch || resume.since > seq) return null;
    const oldest = recent[0]?.seq ?? seq + 1;
    if (resume.since + 1 < oldest) return null;
    return recent.filter((frame) => frame.seq > resume.since);
}

export const wsHandlers: WebSocketHandler<WsData> = {
    open(ws) {
        const replay = replayFor(ws.data.resume);
        for (const frame of replay ?? []) ws.send(JSON.stringify(frame));
        const hello: WsFrame = { v: WS_PROTOCOL_VERSION, type: 'hello', epoch, seq, resync: replay === null };
        ws.send(JSON.stringify(hello));
        sockets.add(ws);
        logger.info(
            { clients: sockets.size, replayed: replay?.length ?? 0, resync: replay === null, seq },
            'ws client connected',
        );
    },
    close(ws) {
        sockets.delete(ws);
        logger.info({ clients: sockets.size }, 'ws client disconnected');
    },
    message() {},
};

export function disconnectDevice(deviceId: string): void {
    for (const ws of sockets) if (ws.data.deviceId === deviceId) ws.close(WS_CLOSE_REFUSED, 'revoked');
}

export function disconnectUnprovisioned(): void {
    for (const ws of sockets)
        if (ws.data.deviceId === null) ws.close(WS_CLOSE_REFUSED, 'provisioning required');
}

export function broadcast(event: WsEvent, payload: { id?: string } = {}): void {
    seq += 1;
    const frame: EventFrame = {
        v: WS_PROTOCOL_VERSION,
        type: 'event',
        epoch,
        seq,
        at: Date.now(),
        event,
        ...payload,
    };
    recent.push(frame);
    if (recent.length > REPLAY_LIMIT) recent.shift();

    const message = JSON.stringify(frame);
    let dropped = 0;
    for (const ws of sockets) {
        if (ws.send(message) === 0) dropped += 1;
    }
    logger.debug({ event, seq, clients: sockets.size, dropped }, 'ws event');
}
