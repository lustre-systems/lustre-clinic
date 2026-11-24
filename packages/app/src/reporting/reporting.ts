import type { ClientRole } from '@lustre/shared';
import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import type { ErrorInfo } from 'react';
import { AppState } from 'react-native';
import { BUILD_VARIANT } from '../api/config';
import { isDemoMode } from '../api/demo';
import { dsnOf, sdkOptions } from './options';
import { allowBreadcrumb, allowEvent, type Boundary, captureProblemReport } from './privacy';
import { lifecycleCrumb, setTrailSink } from './trail';

const options = sdkOptions(dsnOf(Constants.expoConfig?.extra), BUILD_VARIANT);

export const CRASH_REPORTS_ON = options.enabled;

let started = false;

export function startCrashReports(): void {
    if (!CRASH_REPORTS_ON || started) return;
    started = true;

    Sentry.init({
        ...options,
        release: `lustre@${Constants.expoConfig?.version ?? '0.0.0'}`,
        dist: Application.nativeBuildVersion ?? undefined,
        integrations: (defaults) => [
            ...defaults.filter((integration) => integration.name !== 'Breadcrumbs'),
            Sentry.breadcrumbsIntegration({ console: false, xhr: false, fetch: false, sentry: false }),
        ],
        beforeBreadcrumb: (crumb) => (isDemoMode() ? null : allowBreadcrumb(crumb)),
        beforeSend: (event) => (isDemoMode() ? null : allowEvent(event)),
    });

    if (Updates.isEnabled) {
        Sentry.setTags({
            update: Updates.isEmbeddedLaunch || !Updates.updateId ? 'embedded' : Updates.updateId,
            runtime: Updates.runtimeVersion ?? 'unknown',
        });
    }

    setTrailSink((crumb) => Sentry.addBreadcrumb(crumb));
    AppState.addEventListener('change', (state) => Sentry.addBreadcrumb(lifecycleCrumb(state)));
}

const reporters = new Map<Boundary, (error: Error, info: ErrorInfo) => void>();

export function renderErrorReporter(boundary: Boundary): (error: Error, info: ErrorInfo) => void {
    let reporter = reporters.get(boundary);
    if (!reporter) {
        reporter = (error, info) => {
            if (!CRASH_REPORTS_ON) return;
            Sentry.captureException(error, {
                tags: { boundary },
                contexts: { react: { componentStack: info.componentStack ?? '' } },
            });
        };
        reporters.set(boundary, reporter);
    }
    return reporter;
}

export type ProblemReport = { queued: true; ref: string } | { queued: false };

export function reportProblem(): ProblemReport {
    if (!CRASH_REPORTS_ON || isDemoMode()) return { queued: false };
    const id = captureProblemReport(Sentry.getCurrentScope());
    return { queued: true, ref: id.slice(0, 8) };
}

export function tagRole(role: ClientRole): void {
    if (CRASH_REPORTS_ON) Sentry.setTag('role', role);
}
