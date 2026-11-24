import { TRPC_ENDPOINT } from '@lustre/shared';
import type { Breadcrumb } from '@sentry/react-native';

type Sink = (crumb: Breadcrumb) => void;

let sink: Sink | null = null;

export function setTrailSink(next: Sink | null): void {
    sink = next;
}

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

export function procedurePaths(pathname: string): string[] {
    const at = pathname.indexOf(TRPC_ENDPOINT);
    if (at === -1) return [];
    return pathname
        .slice(at + TRPC_ENDPOINT.length)
        .replace(/^\/+/, '')
        .split(',')
        .filter(Boolean);
}

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
    asked: string;
    regular: boolean;
    business: boolean;
    opened: string;
}

export function whatsAppCrumb(open: WhatsAppOpen): Breadcrumb {
    return { category: 'whatsapp', type: 'info', level: 'info', data: { ...open } };
}

export function noteWhatsApp(open: WhatsAppOpen): void {
    sink?.(whatsAppCrumb(open));
}
