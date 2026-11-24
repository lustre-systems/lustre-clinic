const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parse(text: string | null | undefined): [number, number] | null {
    const match = text?.trim().match(VERSION);
    return match ? [Number(match[1]), Number(match[2])] : null;
}

function metadataOf(manifest: unknown): Record<string, unknown> | null {
    if (typeof manifest !== 'object' || manifest === null) return null;
    const metadata = (manifest as { metadata?: unknown }).metadata;
    return typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : null;
}

export function manifestVersion(manifest: unknown): string | null {
    const version = metadataOf(manifest)?.version;
    return typeof version === 'string' ? version : null;
}

export function manifestWantsScreen(manifest: unknown): boolean {
    return metadataOf(manifest)?.screen === 'true';
}

export function isMinorUpdate(
    running: string | null | undefined,
    incoming: string | null | undefined,
): boolean {
    const from = parse(running);
    const to = parse(incoming);
    if (!from || !to) return false;
    return to[0] > from[0] || (to[0] === from[0] && to[1] > from[1]);
}

export const RELOAD_WINDOW_MS = 10_000;

export const CHECK_EVERY_MS = 15 * 60_000;

export function reloadOnReturn(updatePending: boolean, msSinceReturn: number | null, held: boolean): boolean {
    return updatePending && !held && msSinceReturn !== null && msSinceReturn < RELOAD_WINDOW_MS;
}

let holds = 0;

export async function withUpdatesHeld<T>(task: () => Promise<T>): Promise<T> {
    holds += 1;
    try {
        return await task();
    } finally {
        holds -= 1;
    }
}

export function updatesHeld(): boolean {
    return holds > 0;
}
