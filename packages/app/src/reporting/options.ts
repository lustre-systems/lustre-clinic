import type { BuildVariant } from '../api/variant';

export const TRAIL_LENGTH = 100;
export const MAX_BREADCRUMBS = TRAIL_LENGTH * 2;

export function dsnOf(extra: unknown): string | null {
    if (extra === null || typeof extra !== 'object') return null;
    const dsn = (extra as { glitchtipDsn?: unknown }).glitchtipDsn;
    if (typeof dsn !== 'string') return null;
    const trimmed = dsn.trim();
    return trimmed ? trimmed : null;
}

export function reportsFrom(dsn: string | null, variant: BuildVariant): boolean {
    return dsn !== null && variant !== 'demo';
}

export function sdkOptions(dsn: string | null, variant: BuildVariant) {
    const enabled = reportsFrom(dsn, variant);
    return {
        dsn: enabled ? (dsn ?? undefined) : undefined,
        enabled,
        environment: variant,
        sendDefaultPii: false,
        attachScreenshot: false,
        attachViewHierarchy: false,
        enableAutoSessionTracking: false,
        enableAutoPerformanceTracing: false,
        enableUserInteractionTracing: false,
        enableCaptureFailedRequests: false,
        enableLogs: false,
        enableNativeCrashHandling: false,
        enableNdk: false,
        sampleRate: 1,
        maxBreadcrumbs: MAX_BREADCRUMBS,
    } as const;
}
