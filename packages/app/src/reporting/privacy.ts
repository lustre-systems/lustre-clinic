/**
 * What may leave the phone in a crash report (SPEC §17: allow-list, never
 * strip). Each function builds a new object out of the fields it knows and the
 * values those fields are allowed to hold. It does not try to find a name or a
 * phone number and take it out. Anything not named here is dropped, including
 * whatever an SDK update starts collecting later.
 *
 * What is dropped on purpose:
 * - An exception's message. A thrown message can quote whatever the code was
 *   holding. The type, the stack and the error code stay.
 * - `user`, `request`, `extra` and every context not listed below.
 * - A tap's visible text. A tap is known by its `testID` and the component
 *   names above it.
 * - Request URLs. A tRPC query carries its input in the query string, so only
 *   the procedure path, the status and the duration are kept.
 * - Console breadcrumbs, and any category not listed here.
 *
 * A fingerprint is kept only in the one shape `captureProblemReport` gives it,
 * which names the event itself, so each report is its own GlitchTip issue.
 *
 * `allowBreadcrumb` runs twice: as `beforeBreadcrumb`, and again over the
 * event's breadcrumbs in `allowEvent`. Its output passes its own check, which
 * is what lets it run on its own output.
 */
import { isErrorCode, WS_EVENT } from '@lustre/shared';
import type { Breadcrumb, ErrorEvent, Exception, Scope, StackFrame } from '@sentry/react-native';

/** The one message a report may carry: "Report a problem" in Settings. */
export const PROBLEM_REPORT = 'Report a problem';

const PROBLEM_FINGERPRINT = 'problem-report';

/** A Sentry event id: 32 lowercase hex digits. Unique is all it has to be. */
function newEventId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Sends "Report a problem" and returns its event id. The id is chosen here,
 * before the send, because the fingerprint has to name it: every report has
 * the same message, and GlitchTip would otherwise group them into one issue
 * and alert only on the first.
 */
export function captureProblemReport(scope: Scope): string {
    const eventId = newEventId();
    scope.captureMessage(PROBLEM_REPORT, 'warning', {
        event_id: eventId,
        captureContext: { tags: { report: 'problem' }, fingerprint: [PROBLEM_FINGERPRINT, eventId] },
    });
    return eventId;
}

export const BOUNDARIES = ['root', 'day', 'patients', 'stats', 'settings'] as const;
export type Boundary = (typeof BOUNDARIES)[number];

/**
 * Every screen a route stack or the tab bar can name. A route that is not here
 * leaves no crumb, which is the safe way round: a record pushed as a route is
 * named by its own `name` field, and that is data.
 */
export const SCREENS: ReadonlySet<string> = new Set([
    // tabs
    'day',
    'patients',
    'stats',
    'settings',
    // day cluster
    'booking',
    'reschedule',
    'view',
    'treatment',
    'payment',
    'registerPatient',
    // patients cluster
    'record',
    'edit',
    'visit',
    // settings panes and their editors
    'app',
    'appointments',
    'reminders',
    'clinic',
    'branches',
    'hours',
    'procedures',
    'patientFields',
    'new',
    'under',
    'category',
    // stack moves that name no screen
    'back',
    'home',
]);

const PROCEDURE = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
const TEST_ID = /^[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*$/;
const COMPONENT = /^[A-Z][A-Za-z0-9_$.]*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$.]*$/;
const WORD = /^[a-z][a-z0-9_.-]*$/;
const VERSION = /^[\w.@+-]+$/;
const HEX_ID = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^[\w@./:?&=%~+#-]+$/;
const FRAME_FUNCTION = /^[\w$.<>?[\] -]+$/;
const COMPONENT_STACK = /^[\w\s()@./:?&=%~+#$<>,[\]-]*$/;

const LEVELS: ReadonlySet<string> = new Set(['fatal', 'error', 'warning', 'info', 'debug']);
const APP_STATES: ReadonlySet<string> = new Set(['active', 'background', 'inactive']);
const CONNECTION: ReadonlySet<string> = new Set(['unknown', 'probing', 'online', 'offline']);
const LIVE_EVENTS: ReadonlySet<string> = new Set([...Object.values(WS_EVENT), 'hello']);
const LIVE_OUTCOMES: ReadonlySet<string> = new Set(['applied', 'duplicate', 'resync']);

function text(value: unknown, pattern: RegExp, max = 200): string | undefined {
    return typeof value === 'string' && value.length <= max && pattern.test(value) ? value : undefined;
}

function oneOf(value: unknown, allowed: ReadonlySet<string>): string | undefined {
    return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function whole(value: unknown, min: number, max: number): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
        ? value
        : undefined;
}

function finite(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function flag(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/** Drops the keys that came out undefined, so an empty field is absent rather than `null`. */
function compact<T extends Record<string, unknown>>(record: T): Partial<T> {
    const out: Partial<T> = {};
    for (const key of Object.keys(record) as (keyof T)[]) {
        if (record[key] !== undefined) out[key] = record[key];
    }
    return out;
}

function recordOf(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function base(crumb: Breadcrumb, category: string, type: string): Breadcrumb {
    return compact({
        category,
        type,
        level: oneOf(crumb.level, LEVELS) as Breadcrumb['level'],
        timestamp: finite(crumb.timestamp),
    });
}

/**
 * A tap, as `TouchEventBoundary` records it (`data.path`, innermost first, each
 * entry `{ name, label }` with `label` read from `testID`), or as this function
 * already rewrote it (`data.target`, `data.within`).
 */
function tap(crumb: Breadcrumb): Breadcrumb | null {
    const data = recordOf(crumb.data);
    const path = Array.isArray(data.path) ? data.path.map(recordOf) : [];

    const target =
        text(data.target, TEST_ID, 100) ??
        path.map((entry) => text(entry.label, TEST_ID, 100)).find((label) => label !== undefined);

    const names = Array.isArray(data.within) ? data.within : path.map((entry) => entry.name);
    const within = names
        .map((name) => text(name, COMPONENT, 60))
        .filter((name): name is string => name !== undefined)
        .slice(0, 6);

    if (target === undefined && within.length === 0) return null;
    return { ...base(crumb, 'ui.tap', 'user'), data: compact({ target, within }) };
}

function api(crumb: Breadcrumb): Breadcrumb | null {
    const data = recordOf(crumb.data);
    const procedures = (Array.isArray(data.procedures) ? data.procedures : [])
        .map((path) => text(path, PROCEDURE, 80))
        .filter((path): path is string => path !== undefined)
        .slice(0, 20);
    if (procedures.length === 0) return null;

    const status = data.status === null ? null : (whole(data.status, 100, 599) ?? null);
    return {
        ...base(crumb, 'api', 'http'),
        data: compact({ procedures, status, ms: whole(data.ms, 0, 600_000) }),
    };
}

export function allowBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
    const data = recordOf(crumb.data);

    switch (crumb.category) {
        case 'navigation': {
            const to = oneOf(data.to, SCREENS);
            return to === undefined ? null : { ...base(crumb, 'navigation', 'navigation'), data: { to } };
        }
        case 'touch':
        case 'ui.tap':
            return tap(crumb);
        case 'api':
            return api(crumb);
        case 'app.lifecycle': {
            const state = oneOf(data.state, APP_STATES);
            return state === undefined
                ? null
                : { ...base(crumb, 'app.lifecycle', 'navigation'), data: { state } };
        }
        case 'connection': {
            const status = oneOf(data.status, CONNECTION);
            return status === undefined ? null : { ...base(crumb, 'connection', 'info'), data: { status } };
        }
        case 'live': {
            const event = oneOf(data.event, LIVE_EVENTS);
            const outcome = oneOf(data.outcome, LIVE_OUTCOMES);
            return event === undefined || outcome === undefined
                ? null
                : { ...base(crumb, 'live', 'info'), data: { event, outcome } };
        }
        default:
            return null;
    }
}

const TAGS: Record<string, (value: unknown) => boolean> = {
    role: (value) => value === 'doctor' || value === 'secretary',
    boundary: (value) => typeof value === 'string' && (BOUNDARIES as readonly string[]).includes(value),
    error_code: isErrorCode,
    procedure: (value) => text(value, PROCEDURE, 80) !== undefined,
    report: (value) => value === 'problem',
    // Which OTA bundle crashed, so a bad update can be told from a bad APK.
    update: (value) => value === 'embedded' || (typeof value === 'string' && UUID.test(value)),
    runtime: (value) => text(value, VERSION, 64) !== undefined,
    'event.origin': (value) => text(value, WORD, 40) !== undefined,
    'event.environment': (value) => text(value, WORD, 40) !== undefined,
};

function tags(value: unknown): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    for (const [key, tag] of Object.entries(recordOf(value))) {
        if (typeof tag === 'string' && TAGS[key]?.(tag)) out[key] = tag;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function frame(value: StackFrame): StackFrame {
    return compact({
        filename: text(value.filename, FILE, 300),
        abs_path: text(value.abs_path, FILE, 300),
        module: text(value.module, FILE, 200),
        function: text(value.function, FRAME_FUNCTION, 200),
        lineno: whole(value.lineno, 0, 10_000_000),
        colno: whole(value.colno, 0, 10_000_000),
        in_app: flag(value.in_app),
        platform: text(value.platform, WORD, 40),
        debug_id: text(value.debug_id, VERSION, 64),
    });
}

function exception(value: Exception): Exception {
    const frames = value.stacktrace?.frames;
    const mechanism = value.mechanism;
    return compact({
        type: text(value.type, IDENTIFIER, 80),
        mechanism: mechanism
            ? { type: text(mechanism.type, WORD, 60) ?? 'generic', handled: flag(mechanism.handled) }
            : undefined,
        stacktrace: Array.isArray(frames) ? { frames: frames.slice(-100).map(frame) } : undefined,
    });
}

const CONTEXT_FIELDS: Record<string, readonly string[]> = {
    app: ['app_identifier', 'app_version', 'app_build'],
    os: ['name', 'version', 'build'],
    // Not `name`: Android lets the owner call the phone anything, a person's name included.
    device: ['family', 'model', 'manufacturer', 'brand', 'arch', 'simulator'],
    react_native_context: ['js_engine', 'react_native_version', 'hermes_version', 'expo', 'fabric'],
};

function contexts(value: unknown): Record<string, Record<string, unknown>> | undefined {
    const source = recordOf(value);
    const out: Record<string, Record<string, unknown>> = {};

    for (const [name, fields] of Object.entries(CONTEXT_FIELDS)) {
        const context = recordOf(source[name]);
        const kept: Record<string, unknown> = {};
        for (const field of fields) {
            const entry = context[field];
            if (typeof entry === 'boolean') kept[field] = entry;
            else if (text(entry, VERSION, 100) !== undefined) kept[field] = entry;
        }
        if (Object.keys(kept).length > 0) out[name] = kept;
    }

    // Component names and bundle positions, as React writes them. Never a prop.
    const componentStack = text(recordOf(source.react).componentStack, COMPONENT_STACK, 4000);
    if (componentStack !== undefined) out.react = { componentStack };

    return Object.keys(out).length > 0 ? out : undefined;
}

function debugMeta(value: ErrorEvent['debug_meta']): ErrorEvent['debug_meta'] {
    const images = value?.images;
    if (!Array.isArray(images)) return undefined;
    const kept = images
        .map((image) => {
            const fields = recordOf(image);
            const type = text(fields.type, WORD, 40);
            const debugId = text(fields.debug_id, VERSION, 64);
            if (type !== 'sourcemap' || debugId === undefined) return undefined;
            return {
                type: 'sourcemap' as const,
                debug_id: debugId,
                code_file: text(fields.code_file, FILE, 300) ?? '',
            };
        })
        .filter((image) => image !== undefined);
    return kept.length > 0 ? { images: kept } : undefined;
}

/**
 * Every JS crumb is also synced to the native SDK, and on Android the RN SDK
 * merges that native copy back into the event, sorted by time, with a timestamp
 * a few milliseconds off. A crumb that repeats the one before it within 50ms is
 * that copy. Two real taps are never that close.
 */
function withoutNativeCopies(crumbs: Breadcrumb[]): Breadcrumb[] {
    const kept: Breadcrumb[] = [];
    for (const crumb of crumbs) {
        const last = kept[kept.length - 1];
        const copy =
            last !== undefined &&
            last.category === crumb.category &&
            JSON.stringify(last.data) === JSON.stringify(crumb.data) &&
            Math.abs((crumb.timestamp ?? 0) - (last.timestamp ?? 0)) < 0.05;
        if (!copy) kept.push(crumb);
    }
    return kept;
}

function fingerprint(value: unknown, eventId: string | undefined): string[] | undefined {
    return Array.isArray(value) &&
        value.length === 2 &&
        value[0] === PROBLEM_FINGERPRINT &&
        eventId !== undefined &&
        value[1] === eventId
        ? [PROBLEM_FINGERPRINT, eventId]
        : undefined;
}

/**
 * A new event with only the allowed fields. Null when nothing reportable is
 * left: no exception and no "Report a problem" message.
 */
export function allowEvent(event: ErrorEvent): ErrorEvent | null {
    const values = (event.exception?.values ?? []).map(exception);
    const message = event.message === PROBLEM_REPORT ? PROBLEM_REPORT : undefined;
    if (values.length === 0 && message === undefined) return null;

    const breadcrumbs = withoutNativeCopies(
        (event.breadcrumbs ?? []).map(allowBreadcrumb).filter((crumb): crumb is Breadcrumb => crumb !== null),
    );

    const sdk = event.sdk;
    const eventId = text(event.event_id, HEX_ID, 32);

    return {
        ...compact({
            event_id: eventId,
            timestamp: finite(event.timestamp),
            level: oneOf(event.level, LEVELS) as ErrorEvent['level'],
            platform: text(event.platform, WORD, 40),
            release: text(event.release, VERSION, 200),
            dist: text(event.dist, VERSION, 100),
            environment: text(event.environment, WORD, 40),
            sdk:
                sdk && text(sdk.name, FILE, 100) && text(sdk.version, VERSION, 40)
                    ? { name: sdk.name, version: sdk.version }
                    : undefined,
            message,
            fingerprint: fingerprint(event.fingerprint, eventId),
            exception: values.length > 0 ? { values } : undefined,
            breadcrumbs: breadcrumbs.length > 0 ? breadcrumbs : undefined,
            tags: tags(event.tags),
            contexts: contexts(event.contexts),
            debug_meta: debugMeta(event.debug_meta),
        }),
        type: undefined,
    };
}
