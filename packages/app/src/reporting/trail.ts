/**
 * The tap trail (SPEC §17): what the app did just before a report, as
 * breadcrumbs. The SDK keeps the last hundred and attaches them to whatever is
 * sent next, so a glitch that did not crash still arrives with its taps when
 * somebody presses "Report a problem".
 *
 * This file does not import the SDK. `api/` and `navigation/` leave crumbs from
 * here, and `bun test` reaches both, so the SDK is plugged in as a sink by
 * `reporting.ts` when reports are on. With no sink a crumb goes nowhere.
 *
 * Every crumb is built from values the app chose (a route name, a procedure
 * path, a status), and `privacy.ts` still checks each one on the way out.
 */
import { TRPC_ENDPOINT } from '@lustre/shared';
import type { Breadcrumb } from '@sentry/react-native';

type Sink = (crumb: Breadcrumb) => void;

let sink: Sink | null = null;

export function setTrailSink(next: Sink | null): void {
    sink = next;
}

/**
 * What a route stack holds, as a name. Routes are strings or objects tagged by
 * `name` or `kind`, but some stacks hold a record (a branch, a question) whose
 * `name` is data. That comes out here unchanged and is dropped by the
 * allow-list, which only passes the screen names it knows.
 */
export function screenName(route: unknown): string {
    if (typeof route === 'string') return route;
    if (route !== null && typeof route === 'object') {
        const { kind, name } = route as { kind?: unknown; name?: unknown };
        if (typeof kind === 'string') return kind;
        if (typeof name === 'string') return name;
    }
    return 'unnamed';
}

export function screenCrumb(to: string): Breadcrumb {
    return { category: 'navigation', type: 'navigation', level: 'info', data: { to } };
}

export function noteScreen(route: unknown): void {
    sink?.(screenCrumb(screenName(route)));
}

/**
 * The procedure paths out of a request path: `/trpc/patient.search,settings.get`.
 * Only the path is ever read. A tRPC query carries its input in `?input=`, and a
 * search term or a phone number is exactly what that holds.
 */
export function procedurePaths(pathname: string): string[] {
    const at = pathname.indexOf(TRPC_ENDPOINT);
    if (at === -1) return [];
    return pathname
        .slice(at + TRPC_ENDPOINT.length)
        .replace(/^\/+/, '')
        .split(',')
        .filter(Boolean);
}

/** `status` is null when nothing answered: offline, or the request timed out. */
export function apiCrumb(pathname: string, status: number | null, ms: number): Breadcrumb {
    const level = status === null || status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info';
    return {
        category: 'api',
        type: 'http',
        level,
        data: { procedures: procedurePaths(pathname), status, ms: Math.round(ms) },
    };
}

export function noteApi(pathname: string, status: number | null, ms: number): void {
    sink?.(apiCrumb(pathname, status, ms));
}

export function lifecycleCrumb(state: string): Breadcrumb {
    return { category: 'app.lifecycle', type: 'navigation', level: 'info', data: { state } };
}

export function connectionCrumb(status: string): Breadcrumb {
    return { category: 'connection', type: 'info', level: 'info', data: { status } };
}

export function noteConnection(status: string): void {
    sink?.(connectionCrumb(status));
}

/** A `/ws` frame and what the cursor made of it (`api/serverEvents.ts`): the event name, never its ID. */
export function liveCrumb(event: string, outcome: string): Breadcrumb {
    return {
        category: 'live',
        type: 'info',
        level: outcome === 'resync' ? 'warning' : 'info',
        data: { event, outcome },
    };
}

export function noteLive(event: string, outcome: string): void {
    sink?.(liveCrumb(event, outcome));
}

export interface WhatsAppOpen {
    /** The app the branch asked for. */
    asked: string;
    regular: boolean;
    business: boolean;
    /** The package that took the link, `link` when Android was left to pick, `none` when the chosen app refused. */
    opened: string;
}

/** A WhatsApp button and where its link went: never the link, which holds a phone number. */
export function whatsAppCrumb(open: WhatsAppOpen): Breadcrumb {
    return { category: 'whatsapp', type: 'info', level: 'info', data: { ...open } };
}

export function noteWhatsApp(open: WhatsAppOpen): void {
    sink?.(whatsAppCrumb(open));
}
