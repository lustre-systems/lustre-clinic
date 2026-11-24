export function pointerRank(path: string): number {
    if (path === 'android/latest.json') return 3;
    if (path.startsWith('android/')) return 2;
    if (/^updates\/[^/]+\/latest\.json$/.test(path)) return 1;
    return 0;
}

export interface ReleaseFile {
    path: string;
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

export const BUNDLE_DELTA_LEVEL = 15;

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
