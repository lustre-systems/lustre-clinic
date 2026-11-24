import { describe, expect, it } from 'bun:test';
import { dsnOf, MAX_BREADCRUMBS, reportsFrom, sdkOptions } from './options';

const DSN = 'http://key@smilemakers.tailad17f9.ts.net:8000/1';

describe('whether a build reports', () => {
    it('stays off with no DSN, which is every dev machine', () => {
        expect(dsnOf({ glitchtipDsn: null })).toBeNull();
        expect(dsnOf({ glitchtipDsn: '  ' })).toBeNull();
        expect(dsnOf(undefined)).toBeNull();
        expect(reportsFrom(null, 'prod')).toBe(false);
        expect(sdkOptions(null, 'prod')).toMatchObject({ enabled: false, dsn: undefined });
    });

    it('never reports from a demo build, whatever DSN it carries', () => {
        expect(reportsFrom(DSN, 'demo')).toBe(false);
        expect(sdkOptions(DSN, 'demo')).toMatchObject({ enabled: false, dsn: undefined });
    });

    it('reports from a clinic build that was given a DSN', () => {
        expect(dsnOf({ glitchtipDsn: ` ${DSN} ` })).toBe(DSN);
        expect(sdkOptions(DSN, 'prod')).toMatchObject({ enabled: true, dsn: DSN, environment: 'prod' });
    });
});

describe('what the SDK collects (§17)', () => {
    it('sends no default PII, no screenshot, no view hierarchy, no sessions and no tracing', () => {
        expect(sdkOptions(DSN, 'prod')).toMatchObject({
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
        });
        expect(MAX_BREADCRUMBS).toBe(200);
    });
});
