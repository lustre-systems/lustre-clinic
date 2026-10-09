/**
 * Which staged release files `pushReleases.ts` sends, and in what order. Pure,
 * so `bun test` reaches it.
 *
 * Everything under an update id is written once, so a path the server already
 * has is skipped. The pointers (`updates/<runtime>/latest.json`, `android/*`)
 * are rewritten by every release, so those go by checksum, and last: the update
 * a pointer names has landed by the time the pointer does, and the APK lands
 * before the metadata that describes it.
 */

export function pointerRank(path: string): number {
    if (path === 'android/latest.json') return 3;
    if (path.startsWith('android/')) return 2;
    if (/^updates\/[^/]+\/latest\.json$/.test(path)) return 1;
    return 0;
}

export interface ReleaseFile {
    path: string;
    /** Only needed for a pointer. */
    sha256?: string;
}

export function filesToSend(
    local: readonly ReleaseFile[],
    present: ReadonlySet<string>,
    remoteSums: ReadonlyMap<string, string>,
): string[] {
    return local
        .filter(({ path, sha256 }) =>
            pointerRank(path) === 0 ? !present.has(path) : remoteSums.get(path) !== sha256,
        )
        .map(({ path }) => path)
        .sort((a, b) => pointerRank(a) - pointerRank(b) || a.localeCompare(b));
}

/**
 * The server's listing, `F <path>` for every file and `S <sha256> <path>` for
 * each pointer, as `pushReleases.ts` asks for it in one round trip.
 */
export function parseListing(text: string): { present: Set<string>; sums: Map<string, string> } {
    const present = new Set<string>();
    const sums = new Map<string, string>();
    for (const line of text.split('\n')) {
        if (line.startsWith('F ')) present.add(line.slice(2));
        else if (line.startsWith('S ')) {
            const [sum, ...path] = line.slice(2).split(/\s+/);
            if (sum && path.length) sums.set(path.join(' '), sum);
        }
    }
    return { present, sums };
}

const UPDATE_FILE = /^updates\/[^/]+\/([^/]+)\/(.+)$/;
const BUNDLE = /^_expo\/static\/js\/android\/[^/]+\.hbc$/;

/**
 * zstd level for a bundle's delta. 19 saves another 0.25 MB (under 2 s on the
 * line) for 3 s more of compressing.
 */
export const BUNDLE_DELTA_LEVEL = 15;

/**
 * Files on the server that `target` may be made from instead of sent: the same
 * asset in another update (`expo export` names assets by their content), or for
 * the JavaScript bundle, any other update's bundle as the base of a delta.
 */
export function reuseSources(target: string, onServer: readonly string[]): string[] {
    const match = target.match(UPDATE_FILE);
    const id = match?.[1];
    const rest = match?.[2];
    if (!id || !rest) return [];
    const bundle = BUNDLE.test(rest);
    if (!bundle && !rest.startsWith('assets/')) return [];
    return onServer.filter((path) => {
        const other = path.match(UPDATE_FILE);
        if (!other?.[2] || other[1] === id) return false;
        return bundle ? BUNDLE.test(other[2]) : other[2] === rest;
    });
}
