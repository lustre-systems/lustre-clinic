/**
 * Copies the staged releases to a stack: `dist/releases` to prod, or
 * `dist/releases-dev` to dev. `bun ship` runs it after the server is up, and
 * the play's `releases` tag runs it too.
 *
 *   bun scripts/pushReleases.ts --stack=prod|dev [--host=user@address] [--dry-run]
 *
 * One listing, then one zstd tar stream with only what the server lacks
 * (`releasePlan.ts`). Most of an update is already there under an earlier
 * update's id: its assets are named by their content, so the server copies
 * them, and its bundle goes as a delta against the previous bundle.
 *
 * Nothing a phone may be downloading is touched until the new files are
 * complete: the stream lands in `.releases-incoming` beside the releases, every
 * rebuilt file is checked against its sha256, and only then is each file
 * renamed into place, the pointers last, so a phone never sees a pointer to
 * files still landing or half a pointer. Nothing is ever deleted.
 */
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { $ } from 'bun';
import {
    fail,
    megabytes,
    option,
    ROOT,
    rate,
    remote,
    sha256File,
    sshHost,
    stackDir,
    stackOption,
    upload,
} from './clinicServer';
import { BUNDLE_DELTA_LEVEL, filesToSend, parseListing, pointerRank, reuseSources } from './releasePlan';

const SCRIPT = 'pushReleases';
const stack = stackOption(SCRIPT);
const host = await sshHost(SCRIPT);
const LOCAL = resolve(ROOT, option('from') ?? (stack === 'prod' ? 'dist/releases' : 'dist/releases-dev'));
const DIR = stackDir(stack);
const REMOTE = `${DIR}/releases`;
/** The remote script's code for a rebuilt file that did not match: the push is tried again, sending everything. */
const MISMATCH = 65;

if (!(await stat(LOCAL).catch(() => null))?.isDirectory()) {
    process.stdout.write(`Nothing staged in ${LOCAL}. The ${stack} releases are left as they are.\n`);
    process.exit(0);
}

const LIST = `set -eu
[ -d ${DIR} ] || { echo "${DIR} does not exist. Set the stack up first: bun play app --stack=${stack}" >&2; exit 3; }
cd ${REMOTE} 2>/dev/null || exit 0
find . -type f -printf 'F %P\\n'
for f in android/* updates/*/latest.json; do
    if [ -f "$f" ]; then printf 'S %s\\n' "$(sha256sum "$f")"; fi
done`;

/** Reads `.plan` (`copy|patch <sha256> <source> <target>`), then moves everything into place, pointers last. */
const APPLY = `set -eu
umask 022
releases=${REMOTE}
incoming=${DIR}/.releases-incoming
exec 9>${DIR}/.releases.lock
flock -n 9 || { echo "Another push to $releases is still running." >&2; exit 75; }
rm -rf "$incoming"
mkdir -p "$incoming" "$releases"
cd "$incoming"
tar --zstd -xf - --no-same-owner
if [ -f .plan ]; then
    while read -r kind sum source target; do
        mkdir -p "$(dirname "$target")"
        case "$kind" in
            copy) cp "$releases/$source" "$target" ;;
            patch)
                zstd -dq --patch-from="$releases/$source" "$target.zst-patch" -o "$target"
                rm "$target.zst-patch"
                ;;
        esac
        if [ "$(sha256sum < "$target" | cut -d' ' -f1)" != "$sum" ]; then
            echo "$target did not come out as staged." >&2
            exit ${MISMATCH}
        fi
    done < .plan
    rm .plan
fi
sync -f .
place() {
    mkdir -p "$releases/$(dirname "$1")"
    mv -f "$1" "$releases/$1"
}
find . -type f -printf '%P\\n' | grep -v -e '^android/' -e '^updates/[^/]*/latest\\.json$' | while IFS= read -r f; do place "$f"; done
for f in updates/*/latest.json; do
    if [ -f "$f" ]; then place "$f"; fi
done
for f in android/*; do
    if [ -f "$f" ] && [ "$f" != android/latest.json ]; then place "$f"; fi
done
if [ -f android/latest.json ]; then place android/latest.json; fi
sync -f "$releases"
cd /
rm -rf "$incoming"`;

const local = Array.from(new Bun.Glob('**/*').scanSync({ cwd: LOCAL, onlyFiles: true }));
let listing: string;
try {
    listing = await remote(host, LIST);
} catch (error) {
    fail(SCRIPT, (error as Error).message);
}
const { present, sums } = parseListing(listing);
const send = filesToSend(
    await Promise.all(
        local.map(async (path) => ({
            path,
            sha256: pointerRank(path) > 0 ? await sha256File(join(LOCAL, path)) : undefined,
        })),
    ),
    present,
    sums,
);

if (!send.length) {
    process.stdout.write(`The ${stack} stack already has every staged release.\n`);
    process.exit(0);
}

interface Rebuilt {
    kind: 'copy' | 'patch';
    sha256: string;
    source: string;
    target: string;
}

/** What the server can make from files it has: copies of identical files, and deltas for bundles. */
async function plan(): Promise<Rebuilt[]> {
    const onServer = local.filter((path) => present.has(path));
    const rebuilt: Rebuilt[] = [];
    for (const target of send) {
        const sources = reuseSources(target, onServer);
        if (!sources.length) continue;
        const sha256 = await sha256File(join(LOCAL, target));
        let match: string | undefined;
        for (const source of sources) {
            if ((await sha256File(join(LOCAL, source))) === sha256) {
                match = source;
                break;
            }
        }
        if (match) {
            rebuilt.push({ kind: 'copy', sha256, source: match, target });
            continue;
        }
        const newest = (
            await Promise.all(
                sources.map(async (source) => ({ source, at: (await stat(join(LOCAL, source))).mtimeMs })),
            )
        ).sort((a, b) => b.at - a.at)[0];
        if (newest) rebuilt.push({ kind: 'patch', sha256, source: newest.source, target });
    }
    return rebuilt;
}

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

async function push(rebuilt: Rebuilt[]): Promise<number> {
    const work = await mkdtemp(join(tmpdir(), 'lustre-releases-'));
    try {
        for (const { source, target } of rebuilt.filter((file) => file.kind === 'patch')) {
            const patch = join(work, `${target}.zst-patch`);
            await mkdir(dirname(patch), { recursive: true });
            await $`zstd -q -${BUNDLE_DELTA_LEVEL} -T0 --patch-from=${join(LOCAL, source)} ${join(LOCAL, target)} -o ${patch}`;
        }
        await Bun.write(
            join(work, '.plan'),
            rebuilt.map((file) => `${file.kind} ${file.sha256} ${file.source} ${file.target}\n`).join(''),
        );
        const made = new Set(rebuilt.map((file) => file.target));
        const sent = send.filter((path) => !made.has(path));
        const extras = [
            '.plan',
            ...rebuilt.filter((file) => file.kind === 'patch').map((file) => `${file.target}.zst-patch`),
        ];
        const copied = rebuilt.filter((file) => file.kind === 'copy').length;
        const deltas = rebuilt.length - copied;
        process.stdout.write(
            `Sending ${count(sent.length, 'file')}${deltas ? ` and ${count(deltas, 'delta')}` : ''}${copied ? `; the server copies ${count(copied, 'file')} it already has` : ''}.\n`,
        );
        const result = await upload(host, APPLY, [
            'tar',
            '--use-compress-program=zstd -19 -T0',
            '--owner=0',
            '--group=0',
            '-cf',
            '-',
            '-C',
            work,
            ...extras,
            '-C',
            LOCAL,
            '--',
            ...sent,
        ]);
        if (result.code === 0) process.stdout.write(`Sent ${rate(result)}.\n`);
        return result.code;
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}

const sizes = await Promise.all(send.map(async (path) => (await stat(join(LOCAL, path))).size));
process.stdout.write(
    `${send.length} of ${local.length} staged files are new to ${stack} (${megabytes(sizes.reduce((a, b) => a + b, 0))} before compression).\n`,
);
if (process.argv.includes('--dry-run')) {
    process.stdout.write(`${send.join('\n')}\n`);
    process.exit(0);
}

let code = await push(await plan());
if (code === MISMATCH) {
    process.stdout.write('A file the server rebuilt did not match. Sending everything instead.\n');
    code = await push([]);
}
if (code !== 0) {
    fail(
        SCRIPT,
        `the copy failed (${code}). Run it again: the pointers move last, so phones are still offered a complete release.`,
    );
}
process.stdout.write(`The releases are on the ${stack} stack.\n`);
