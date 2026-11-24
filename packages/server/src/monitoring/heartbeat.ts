import { logger } from '../logger.ts';

export interface HeartbeatOptions {
    url: string;
    intervalMs: number;
    isHealthy?: () => Promise<boolean>;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface Heartbeat {
    ping(): Promise<boolean>;
    stop(): void;
}

export function startHeartbeat(options: HeartbeatOptions): Heartbeat {
    const { url, intervalMs, isHealthy, fetchImpl = fetch } = options;

    async function ping(): Promise<boolean> {
        if (isHealthy && !(await isHealthy())) {
            logger.warn('heartbeat withheld: the server is not healthy');
            return false;
        }
        try {
            const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
            if (!res.ok) {
                logger.warn({ status: res.status }, 'heartbeat rejected');
                return false;
            }
            logger.debug('heartbeat sent');
            return true;
        } catch (err) {
            logger.warn({ err }, 'heartbeat failed');
            return false;
        }
    }

    void ping();
    const timer = setInterval(() => void ping(), intervalMs);
    timer.unref?.();

    logger.info({ intervalSeconds: intervalMs / 1000 }, 'heartbeat started');

    return {
        ping,
        stop() {
            clearInterval(timer);
        },
    };
}
