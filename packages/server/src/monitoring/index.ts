import { config } from '../config.ts';
import { logger } from '../logger.ts';
import { type Alert, type Alerter, createAlerter, discordSender, noopSender } from './alert.ts';
import { type Heartbeat, startHeartbeat } from './heartbeat.ts';

export * from './alert.ts';
export * from './heartbeat.ts';

const alerter: Alerter = createAlerter({
    send: config.DISCORD_WEBHOOK_URL ? discordSender(config.DISCORD_WEBHOOK_URL) : noopSender,
});

export function alert(a: Alert): Promise<void> {
    return alerter.report(a);
}

let heartbeat: Heartbeat | undefined;

export interface MonitoringOptions {
    isHealthy?: () => Promise<boolean>;
}

export function startMonitoring(options: MonitoringOptions = {}): void {
    if (!config.DISCORD_WEBHOOK_URL) {
        logger.warn('DISCORD_WEBHOOK_URL is unset — alerts are logged only');
    }

    process.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'uncaught exception');
        void alert({
            code: 'process.uncaught_exception',
            summary: 'Uncaught exception on the server.',
            context: { error: err.name },
        });
    });

    process.on('unhandledRejection', (reason) => {
        logger.error({ err: reason }, 'unhandled rejection');
        void alert({
            code: 'process.unhandled_rejection',
            summary: 'Unhandled promise rejection on the server.',
            context: { error: reason instanceof Error ? reason.name : typeof reason },
        });
    });

    if (config.HEARTBEAT_URL) {
        heartbeat = startHeartbeat({
            url: config.HEARTBEAT_URL,
            intervalMs: config.HEARTBEAT_INTERVAL_SECONDS * 1000,
            isHealthy: options.isHealthy,
        });
    } else {
        logger.warn('HEARTBEAT_URL is unset — no external liveness check');
    }
}

export function stopMonitoring(): void {
    heartbeat?.stop();
    heartbeat = undefined;
}
